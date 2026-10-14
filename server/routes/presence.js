// Presença: check-in, pausas, retorno e checkout com GPS + selfie; acompanhamento e confirmação pelo gestor.
import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole } from '../auth.js';
import { q, tx } from '../db.js';
import { HttpError, fail, text } from '../http.js';
import { sendMail } from '../mail.js';
import { EVENT_TYPES, checkinWindowError, distanceMeters, nextState, transitionError, workedTime } from '../rules.js';
import { decodeBase64, removeFile, saveFile, sniff } from '../storage.js';

const r = Router();
const MAX_SELFIE_BYTES = 500 * 1024;
const TOKEN_MS = 2 * 60 * 1000;

const sessionSql = (extraCols = '', extraJoins = '') => `
  SELECT ws.*, ${extraCols} a.user_id, a.id AS application_id, j.id AS job_id, j.title, j.starts_at, j.ends_at, j.status AS job_status,
         j.break_count, j.break_minutes, j.daily_value,
         u.id AS unit_id, u.name AS unit_name, u.address AS unit_address, u.lat AS unit_lat, u.lng AS unit_lng, u.radius_m, u.max_accuracy_m
  FROM work_sessions ws JOIN applications a ON a.id = ws.application_id
  JOIN jobs j ON j.id = a.job_id JOIN units u ON u.id = j.unit_id ${extraJoins}`;
const SESSION_SQL = sessionSql();

const eventsOf = (sessionIds) =>
  sessionIds.length
    ? q('SELECT id, work_session_id, type, occurred_at, accuracy_m, distance_m, radius_m, validation FROM presence_events WHERE work_session_id IN (?) ORDER BY occurred_at', [sessionIds])
    : Promise.resolve([]);

// ---------- Profissional ----------

r.get('/me/sessions/:id', requireRole('PROFISSIONAL'), async (req, res) => {
  const [s] = await q(`${SESSION_SQL} WHERE ws.id = ? AND a.user_id = ?`, [req.params.id, req.user.id]);
  if (!s) fail(404, 'Atividade não encontrada.');
  const events = await eventsOf([s.id]);
  res.json({ session: s, events, worked: workedTime(events), serverNow: new Date() });
});

r.post('/sessions/:id/token', requireRole('PROFISSIONAL'), async (req, res) => {
  const [s] = await q('SELECT ws.id FROM work_sessions ws JOIN applications a ON a.id = ws.application_id WHERE ws.id = ? AND a.user_id = ?', [req.params.id, req.user.id]);
  if (!s) fail(404, 'Atividade não encontrada.');
  const token = randomBytes(24).toString('base64url');
  await q('INSERT INTO event_tokens (token, work_session_id, expires_at) VALUES (?,?,?)', [token, s.id, new Date(Date.now() + TOKEN_MS)]);
  res.json({ token });
});

r.post('/sessions/:id/events', requireRole('PROFISSIONAL'), async (req, res) => {
  const { type, token, clientTs } = req.body;
  if (!EVENT_TYPES.includes(type)) fail(400, 'Evento inválido.');
  const pos = { lat: Number(req.body.lat), lng: Number(req.body.lng) };
  const accuracy = Number(req.body.accuracy);
  if (!(Math.abs(pos.lat) <= 90 && Math.abs(pos.lng) <= 180 && accuracy > 0)) fail(400, 'Localização GPS obrigatória.');
  const img = decodeBase64(req.body.selfie);
  if (sniff(img) !== 'image/jpeg' || img.length > MAX_SELFIE_BYTES) fail(400, 'Selfie obrigatória, tirada pela câmera.');

  let saved;
  try {
    const result = await tx(async (tq) => {
      const now = new Date();
      const [s] = await tq(`${SESSION_SQL} WHERE ws.id = ? FOR UPDATE`, [req.params.id]);
      if (!s || s.user_id !== req.user.id) fail(404, 'Atividade não encontrada.');
      if (s.job_status === 'CANCELADA') fail(409, 'Esta vaga foi cancelada.');

      const used = await tq('UPDATE event_tokens SET used_at = ? WHERE token = ? AND work_session_id = ? AND used_at IS NULL AND expires_at > ?', [now, String(token ?? ''), s.id, now]);
      if (used.affectedRows !== 1) fail(409, 'Validação expirada ou já utilizada. Tente novamente.');

      const ctx = { breaksUsed: s.breaks_used, breakCount: s.break_count };
      const next = nextState(s.status, type, ctx);
      if (!next) fail(409, transitionError(s.status, type, ctx));
      if (type === 'CHECK_IN') {
        const windowError = checkinWindowError(s.starts_at, now);
        if (windowError) fail(422, windowError);
      }
      if (accuracy > s.max_accuracy_m) fail(422, `Precisão do GPS insuficiente (${Math.round(accuracy)} m). Vá para uma área aberta e tente de novo.`);
      const distance = distanceMeters(pos, { lat: s.unit_lat, lng: s.unit_lng });
      if (distance > s.radius_m) fail(422, `Você está a ${Math.round(distance)} m da loja. É preciso estar a até ${s.radius_m} m.`);

      saved = await saveFile(`selfies/${now.toISOString().slice(0, 7)}`, img, 'image/jpeg');
      const clientDate = new Date(clientTs);
      await tq(
        `INSERT INTO presence_events (id, work_session_id, type, actor_user_id, occurred_at, client_ts, lat, lng, accuracy_m,
           unit_lat, unit_lng, distance_m, radius_m, selfie_key, selfie_sha256, token)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), s.id, type, req.user.id, now, Number.isNaN(+clientDate) ? null : clientDate, pos.lat, pos.lng, accuracy,
          s.unit_lat, s.unit_lng, distance, s.radius_m, saved.key, saved.sha256, token],
      );
      const breakEndsAt = type === 'PAUSE_START' ? new Date(now.getTime() + s.break_minutes * 60000) : null;
      await tq('UPDATE work_sessions SET status = ?, breaks_used = breaks_used + ?, break_ends_at = ?, break_email_sent_at = NULL WHERE id = ?', [
        next, type === 'PAUSE_START' ? 1 : 0, breakEndsAt, s.id,
      ]);
      return { status: next, breakEndsAt };
    });
    res.json(result);
  } catch (e) {
    if (saved) await removeFile(saved.key);
    // Tentativa recusada não vira evento de presença, mas fica na auditoria.
    if (e instanceof HttpError && e.status !== 404) {
      await audit(q, req, 'PRESENCE_REJECTED', 'work_session', req.params.id, { after: { type, ...pos, accuracy, reason: e.message } });
    }
    throw e;
  }
});

// ---------- Gestão ----------

r.get('/manage/sessions', requireRole('GESTOR', 'ADMINISTRADOR'), async (req, res) => {
  await assertUnit(req.user, req.query.unitId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '')) fail(400, 'Data inválida.');
  // ponytail: dia operacional fixo em UTC-3 (Brasil sem horário de verão); usar fuso por unidade se houver lojas fora de Brasília.
  const dayStart = new Date(`${req.query.date}T00:00:00-03:00`);
  const sessions = await q(
    `${sessionSql('w.name AS worker_name, dc.result AS confirmation,', 'JOIN users w ON w.id = a.user_id LEFT JOIN daily_confirmations dc ON dc.application_id = a.id')}
     WHERE j.unit_id = ? AND j.starts_at >= ? AND j.starts_at < ?
     ORDER BY j.starts_at, w.name`,
    [req.query.unitId, dayStart, new Date(dayStart.getTime() + 24 * 3600e3)],
  );
  const events = await eventsOf(sessions.map((s) => s.id));
  res.json({
    serverNow: new Date(),
    sessions: sessions.map((s) => {
      const own = events.filter((e) => e.work_session_id === s.id);
      return { ...s, events: own, worked: workedTime(own) };
    }),
  });
});

r.post('/manage/applications/:id/confirm', requireRole('GESTOR', 'ADMINISTRADOR'), async (req, res) => {
  const result = req.body.result;
  if (result !== 'CONCLUIDA' && result !== 'NAO_COMPARECEU') fail(400, 'Resultado inválido.');
  const note = text(req.body.note, 'observação', { max: 500, optional: true });
  const [s] = await q(`${SESSION_SQL} WHERE a.id = ?`, [req.params.id]);
  if (!s) fail(404, 'Não encontrado.');
  await assertUnit(req.user, s.unit_id);
  const [app] = await q('SELECT status FROM applications WHERE id = ?', [req.params.id]);
  if (app.status !== 'APROVADA') fail(409, 'Somente candidaturas aprovadas recebem confirmação.');
  if (result === 'CONCLUIDA' && s.status !== 'FINALIZADA') fail(409, 'A diária só pode ser concluída após o checkout.');
  if (result === 'NAO_COMPARECEU' && (s.status !== 'AGUARDANDO_CHECKIN' || new Date() < new Date(new Date(s.starts_at).getTime() + 15 * 60000))) {
    fail(409, 'Falta só pode ser registrada sem check-in e após a tolerância de 15 minutos.');
  }
  try {
    await q('INSERT INTO daily_confirmations (application_id, result, note, confirmed_by) VALUES (?,?,?,?)', [req.params.id, result, note, req.user.id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') fail(409, 'Esta diária já foi confirmada.');
    throw e;
  }
  await audit(q, req, 'DAILY_CONFIRM', 'application', req.params.id, { after: { result, note } });
  res.json({ ok: true });
});

// ---------- Fim de pausa ----------

// ponytail: roda via setInterval no processo do app; mover para o cron da Hostinger se o processo hibernar sem tráfego.
export async function sweepBreaks() {
  const now = new Date();
  await q("UPDATE work_sessions SET status = 'PAUSA_EXCEDIDA' WHERE status = 'EM_PAUSA' AND break_ends_at < ?", [now]);
  const due = await q(
    `SELECT ws.id, w.email, w.name FROM work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN users w ON w.id = a.user_id
     WHERE ws.status = 'PAUSA_EXCEDIDA' AND ws.break_email_sent_at IS NULL`,
  );
  for (const d of due) {
    try {
      await sendMail(d.email, 'UpService: sua pausa terminou', `Olá, ${d.name}.\n\nO tempo da sua pausa terminou. Abra o app UpService e registre o retorno.\n\nEste é um aviso automático.`);
      await q('UPDATE work_sessions SET break_email_sent_at = ? WHERE id = ?', [now, d.id]);
    } catch (e) {
      console.error('falha ao enviar aviso de fim de pausa', d.id, e.message);
    }
  }
}

export default r;
