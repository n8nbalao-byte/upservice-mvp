// Presença: check-in, pausas, retorno e checkout com GPS + selfie; exceções e fechamento administrativo pelo gestor.
import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole } from '../auth.js';
import { q, tx } from '../db.js';
import { HttpError, fail, requireReason, text } from '../http.js';
import { sendMailSafe } from '../mail.js';
import { createOccurrence, ctx as penaltyCtx, endBlock, flush, managerEmails } from '../penalties.js';
import {
  ALERT_COOLDOWN_MS, CHECKOUT_TOLERANCE_MS, coversShift, CLOSURE_SOURCES, EVENT_TYPES, EXCEPTION_REASONS, PING_MIN_GAP_MS,
  checkinWindowError, distanceMeters, exceptionWindowError, nextState, transitionError, workedTime,
} from '../rules.js';
import { decodeBase64, removeFile, saveFile, sniff } from '../storage.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
const MAX_SELFIE_BYTES = 500 * 1024;
const TOKEN_MS = 2 * 60 * 1000;
const ACTIVE = ['EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA'];

const sessionSql = (extraCols = '', extraJoins = '') => `
  SELECT ws.*, ${extraCols} a.user_id, a.id AS application_id, j.id AS job_id, j.title, j.starts_at, j.ends_at, j.status AS job_status,
         j.break_count, j.break_minutes, j.daily_value,
         u.id AS unit_id, u.name AS unit_name, u.address AS unit_address, u.lat AS unit_lat, u.lng AS unit_lng, u.radius_m, u.max_accuracy_m
  FROM work_sessions ws JOIN applications a ON a.id = ws.application_id
  JOIN jobs j ON j.id = a.job_id JOIN units u ON u.id = j.unit_id ${extraJoins}`;
const SESSION_SQL = sessionSql();

const eventsOf = (sessionIds) =>
  sessionIds.length
    ? q(`SELECT id, work_session_id, type, occurred_at, accuracy_m, distance_m, radius_m, validation, closure_source, note,
                selfie_key IS NOT NULL AS has_selfie
         FROM presence_events WHERE work_session_id IN (?) ORDER BY occurred_at`, [sessionIds])
    : Promise.resolve([]);

const exceptionsOf = (sessionIds) =>
  sessionIds.length
    ? q(`SELECT id, work_session_id, type, reason, error_message, message, requested_at, accuracy_m, distance_m, status, decided_at, decision_reason
         FROM presence_exceptions WHERE work_session_id IN (?) ORDER BY requested_at`, [sessionIds])
    : Promise.resolve([]);

const alertsOf = (sessionIds) =>
  sessionIds.length
    ? q('SELECT id, work_session_id, at, accuracy_m, distance_m, acknowledged_at FROM location_alerts WHERE work_session_id IN (?) ORDER BY at', [sessionIds])
    : Promise.resolve([]);

function readPosition(body) {
  const pos = { lat: Number(body.lat), lng: Number(body.lng) };
  const accuracy = Number(body.accuracy);
  if (!(Math.abs(pos.lat) <= 90 && Math.abs(pos.lng) <= 180 && accuracy > 0)) fail(400, 'Localização GPS obrigatória.');
  return { pos, accuracy };
}

function readSelfie(body) {
  const img = decodeBase64(body.selfie);
  if (sniff(img) !== 'image/jpeg' || img.length > MAX_SELFIE_BYTES) fail(400, 'Selfie obrigatória, tirada pela câmera.');
  return img;
}

async function consumeToken(tq, sessionId, token, now) {
  const used = await tq('UPDATE event_tokens SET used_at = ? WHERE token = ? AND work_session_id = ? AND used_at IS NULL AND expires_at > ?', [now, String(token ?? ''), sessionId, now]);
  if (used.affectedRows !== 1) fail(409, 'Validação expirada ou já utilizada. Tente novamente.');
}

/** Única forma de gravar um evento de presença e mudar o estado da jornada (GPS, exceção aprovada ou fechamento administrativo). */
async function applyEvent(tq, s, next, e) {
  await tq('INSERT INTO presence_events SET ?', [{
    id: randomUUID(), work_session_id: s.id, type: e.type, actor_user_id: e.actorId, occurred_at: e.at,
    client_ts: e.clientTs ?? null, lat: e.lat ?? null, lng: e.lng ?? null, accuracy_m: e.accuracy ?? null,
    unit_lat: s.unit_lat, unit_lng: s.unit_lng, distance_m: e.distance ?? null, radius_m: s.radius_m,
    selfie_key: e.selfieKey ?? null, selfie_sha256: e.selfieSha ?? null, validation: e.validation, token: e.token ?? null,
    closure_source: e.closureSource ?? null, note: e.note ?? null, exception_id: e.exceptionId ?? null,
  }]);
  const pauseStart = e.type === 'PAUSE_START';
  await tq('UPDATE work_sessions SET status = ?, breaks_used = breaks_used + ?, break_ends_at = ?, break_email_sent_at = NULL WHERE id = ?', [
    next, pauseStart ? 1 : 0, pauseStart ? new Date(new Date(e.at).getTime() + s.break_minutes * 60000) : null, s.id,
  ]);
  if (next === 'FINALIZADA') {
    const worked = await storeWorkedTime(tq, s.id);
    // Checkout por GPS ou por exceção aprovada confirma a diária (confirmed_by NULL = automático) só se as horas
    // cobrem a jornada: saída antecipada e fechamento administrativo (checkout esquecido) ficam com o gestor.
    if (e.validation !== 'FECHAMENTO_ADMINISTRATIVO' && worked && coversShift(worked.workedMin, s)) {
      const done = await tq("INSERT IGNORE INTO daily_confirmations (application_id, result, note, confirmed_by) VALUES (?, 'CONCLUIDA', 'Confirmada automaticamente no checkout', NULL)", [s.application_id]);
      if (done.affectedRows) await audit(tq, null, 'DAILY_AUTO_CONFIRM', 'application', s.application_id, { after: { result: 'CONCLUIDA' } });
    }
  }
}

/** Horas gravadas no fechamento: relatórios de muitos dias não precisam recalcular evento por evento. */
export async function storeWorkedTime(tq, sessionId) {
  const worked = workedTime(await tq('SELECT type, occurred_at, validation FROM presence_events WHERE work_session_id = ? ORDER BY occurred_at', [sessionId]));
  if (worked) await tq('UPDATE work_sessions SET worked_min = ?, break_min = ?, sources = ? WHERE id = ?', [worked.workedMin, worked.breakMin, worked.sources.join(','), sessionId]);
  return worked;
}

async function loadOwnSession(tq, req) {
  const [s] = await tq(`${SESSION_SQL} WHERE ws.id = ? FOR UPDATE`, [req.params.id]);
  if (!s || s.user_id !== req.user.id) fail(404, 'Atividade não encontrada.');
  if (s.job_status === 'CANCELADA') fail(409, 'Esta vaga foi cancelada.');
  return s;
}

// ---------- Profissional ----------

r.get('/me/sessions/:id', requireRole('PROFISSIONAL'), async (req, res) => {
  const [s] = await q(`${SESSION_SQL} WHERE ws.id = ? AND a.user_id = ?`, [req.params.id, req.user.id]);
  if (!s) fail(404, 'Atividade não encontrada.');
  const [events, exceptions] = await Promise.all([eventsOf([s.id]), exceptionsOf([s.id])]);
  res.json({ session: s, events, exceptions, worked: workedTime(events), serverNow: new Date() });
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
  const img = readSelfie(req.body);

  let saved;
  try {
    const result = await tx(async (tq) => {
      const now = new Date();
      const s = await loadOwnSession(tq, req);
      await consumeToken(tq, s.id, token, now);

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
      await applyEvent(tq, s, next, {
        type, actorId: req.user.id, at: now, clientTs: Number.isNaN(+clientDate) ? null : clientDate, ...pos, accuracy, distance,
        selfieKey: saved.key, selfieSha: saved.sha256, validation: 'GPS_VALIDADO', token,
      });
      return { status: next };
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

r.post('/sessions/:id/ping', requireRole('PROFISSIONAL'), async (req, res) => {
  const { pos, accuracy } = readPosition(req.body);
  const result = await tx(async (tq) => {
    const s = await loadOwnSession(tq, req);
    if (!ACTIVE.includes(s.status)) fail(409, 'A atividade não está em andamento.');
    const now = new Date();
    if (s.last_ping_at && now - new Date(s.last_ping_at) < PING_MIN_GAP_MS) return { ignored: true };
    const distance = distanceMeters(pos, { lat: s.unit_lat, lng: s.unit_lng });
    const inside = distance <= s.radius_m;
    await tq('UPDATE work_sessions SET last_ping_at = ?, last_ping_distance_m = ?, last_ping_accuracy_m = ?, last_ping_inside = ? WHERE id = ?', [now, distance, accuracy, inside ? 1 : 0, s.id]);
    // Só alerta com leitura confiável, fora do raio, em atividade (na pausa a pessoa pode sair) e uma vez a cada 30 min.
    if (inside || s.status !== 'EM_ATIVIDADE' || accuracy > s.max_accuracy_m) return { inside };
    const [recent] = await tq('SELECT 1 FROM location_alerts WHERE work_session_id = ? AND at > ? LIMIT 1', [s.id, new Date(now.getTime() - ALERT_COOLDOWN_MS)]);
    if (recent) return { inside };
    const alert = { id: randomUUID(), work_session_id: s.id, at: now, ...pos, accuracy_m: accuracy, distance_m: distance };
    await tq('INSERT INTO location_alerts SET ?', [alert]);
    await audit(tq, req, 'LOCATION_ALERT', 'work_session', s.id, { after: { distance_m: Math.round(distance), accuracy_m: Math.round(accuracy) } });
    return { inside, alert: { unitId: s.unit_id, unitName: s.unit_name, title: s.title, distance } };
  });
  if (result.alert) {
    const a = result.alert;
    for (const to of await managerEmails(q, a.unitId)) {
      await sendMailSafe(to, `UpService: saída do raio em ${a.unitName}`, `${req.user.name} está a ${Math.round(a.distance)} m de ${a.unitName} durante a atividade "${a.title}". Veja em Atividades ou na central de pendências.`);
    }
  }
  res.json({ inside: result.inside ?? null, alert: !!result.alert, ignored: !!result.ignored });
});

// Falha de GPS, precisão, permissão, raio ou atraso: o profissional pede exceção e o gestor decide. Nunca vira GPS validado.
r.post('/sessions/:id/exceptions', requireRole('PROFISSIONAL'), async (req, res) => {
  const { type, token } = req.body;
  if (!EVENT_TYPES.includes(type)) fail(400, 'Evento inválido.');
  if (!EXCEPTION_REASONS.includes(req.body.reason)) fail(400, 'Motivo inválido.');
  const img = readSelfie(req.body);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const hasPos = req.body.lat != null && req.body.lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const accuracy = hasPos && Number(req.body.accuracy) > 0 ? Number(req.body.accuracy) : null;

  let saved;
  try {
    const done = await tx(async (tq) => {
      const now = new Date();
      const s = await loadOwnSession(tq, req);
      await consumeToken(tq, s.id, token, now);
      const ctx = { breaksUsed: s.breaks_used, breakCount: s.break_count };
      if (!nextState(s.status, type, ctx)) fail(409, transitionError(s.status, type, ctx));
      const windowError = exceptionWindowError(type, s.starts_at, s.ends_at, now);
      if (windowError) fail(422, windowError);

      saved = await saveFile(`selfies/${now.toISOString().slice(0, 7)}`, img, 'image/jpeg');
      const exc = {
        id: randomUUID(), work_session_id: s.id, type, reason: req.body.reason,
        error_message: text(req.body.errorMessage, 'erro', { max: 500, optional: true }),
        message: text(req.body.message, 'mensagem', { max: 500, optional: true }),
        requested_by: req.user.id, requested_at: now,
        lat: hasPos ? lat : null, lng: hasPos ? lng : null, accuracy_m: accuracy,
        distance_m: hasPos ? distanceMeters({ lat, lng }, { lat: s.unit_lat, lng: s.unit_lng }) : null,
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
        selfie_key: saved.key, selfie_sha256: saved.sha256, prev_status: s.status,
      };
      await tq('INSERT INTO presence_exceptions SET ?', [exc]);
      await tq("UPDATE work_sessions SET status = 'PENDENTE_DE_EXCECAO' WHERE id = ?", [s.id]);
      await audit(tq, req, 'EXCEPTION_REQUEST', 'presence_exception', exc.id, { after: { type, reason: exc.reason, distance_m: exc.distance_m } });
      return { id: exc.id, unitId: s.unit_id, unitName: s.unit_name, title: s.title };
    });
    for (const to of await managerEmails(q, done.unitId)) {
      await sendMailSafe(to, `UpService: exceção para analisar em ${done.unitName}`, `${req.user.name} pediu exceção de presença na vaga "${done.title}". Analise em Atividades ou na central de pendências do painel.`);
    }
    res.status(201).json({ id: done.id, status: 'PENDENTE_DE_EXCECAO' });
  } catch (e) {
    if (saved) await removeFile(saved.key);
    throw e;
  }
});

r.post('/me/sessions/:id/reported-end', requireRole('PROFISSIONAL'), async (req, res) => {
  const at = new Date(req.body.time);
  if (Number.isNaN(+at) || at > new Date()) fail(400, 'Informe um horário de saída válido (não pode ser no futuro).');
  const note = text(req.body.note, 'observação', { max: 500, optional: true });
  await tx(async (tq) => {
    const s = await loadOwnSession(tq, req);
    if (s.status !== 'PENDENTE_DE_FECHAMENTO') fail(409, 'Não há checkout pendente nesta atividade.');
    const [last] = await tq('SELECT MAX(occurred_at) AS t FROM presence_events WHERE work_session_id = ?', [s.id]);
    if (last.t && at <= new Date(last.t)) fail(400, 'O horário de saída deve ser depois do último registro.');
    await tq('UPDATE work_sessions SET reported_end_at = ?, reported_end_note = ? WHERE id = ?', [at, note, s.id]);
    await audit(tq, req, 'REPORTED_END', 'work_session', s.id, { after: { at, note } });
  });
  res.json({ ok: true });
});

// ---------- Gestão ----------

r.get('/manage/sessions', MANAGERS, async (req, res) => {
  await assertUnit(req.user, req.query.unitId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '')) fail(400, 'Data inválida.');
  // ponytail: dia operacional fixo em UTC-3 (Brasil sem horário de verão); usar fuso por unidade se houver lojas fora de Brasília.
  const dayStart = new Date(`${req.query.date}T00:00:00-03:00`);
  const sessions = await q(
    `${sessionSql(
      `w.name AS worker_name, dc.result AS confirmation, j.is_cashier,
       cb.id AS cash_break_id, cb.amount AS cash_break_amount, cb.final_amount AS cash_break_final, cb.status AS cash_break_status, cb.reason AS cash_break_reason,`,
      'JOIN users w ON w.id = a.user_id LEFT JOIN daily_confirmations dc ON dc.application_id = a.id LEFT JOIN cash_breaks cb ON cb.application_id = a.id',
    )}
     WHERE j.unit_id = ? AND j.starts_at >= ? AND j.starts_at < ?
     ORDER BY j.starts_at, w.name`,
    [req.query.unitId, dayStart, new Date(dayStart.getTime() + 24 * 3600e3)],
  );
  const ids = sessions.map((s) => s.id);
  const [events, exceptions, alerts] = await Promise.all([eventsOf(ids), exceptionsOf(ids), alertsOf(ids)]);
  res.json({
    serverNow: new Date(),
    sessions: sessions.map((s) => {
      const own = events.filter((e) => e.work_session_id === s.id);
      return {
        ...s, events: own, worked: workedTime(own),
        exceptions: exceptions.filter((x) => x.work_session_id === s.id),
        alerts: alerts.filter((a) => a.work_session_id === s.id),
      };
    }),
  });
});

r.post('/manage/location-alerts/:id/ack', MANAGERS, async (req, res) => {
  const [a] = await q(
    `SELECT la.id, la.acknowledged_at, j.unit_id FROM location_alerts la JOIN work_sessions ws ON ws.id = la.work_session_id
     JOIN applications ap ON ap.id = ws.application_id JOIN jobs j ON j.id = ap.job_id WHERE la.id = ?`,
    [req.params.id],
  );
  if (!a) fail(404, 'Não encontrado.');
  await assertUnit(req.user, a.unit_id);
  if (!a.acknowledged_at) {
    await q('UPDATE location_alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?', [req.user.id, new Date(), a.id]);
    await audit(q, req, 'LOCATION_ALERT_ACK', 'location_alert', a.id);
  }
  res.json({ ok: true });
});

async function loadManagedSession(tq, user, sessionId) {
  const [s] = await tq(`${SESSION_SQL} WHERE ws.id = ? FOR UPDATE`, [sessionId]);
  if (!s) fail(404, 'Não encontrado.');
  await assertUnit(user, s.unit_id);
  return s;
}

// Aprovar grava o evento com o horário do PEDIDO (o gestor não altera horário) e validação EXCECAO_APROVADA.
r.post('/manage/exceptions/:id/decide', MANAGERS, async (req, res) => {
  const decision = req.body.decision;
  if (decision !== 'APROVADA' && decision !== 'RECUSADA') fail(400, 'Decisão inválida.');
  const reason = requireReason(req.body.reason);
  const [found] = await q('SELECT work_session_id FROM presence_exceptions WHERE id = ?', [req.params.id]);
  if (!found) fail(404, 'Não encontrado.');
  const result = await tx(async (tq) => {
    const s = await loadManagedSession(tq, req.user, found.work_session_id);
    const [exc] = await tq('SELECT * FROM presence_exceptions WHERE id = ? FOR UPDATE', [req.params.id]);
    if (exc.status !== 'PENDENTE') fail(409, 'Esta exceção já foi analisada.');
    if (s.status !== 'PENDENTE_DE_EXCECAO') fail(409, 'A atividade não está aguardando exceção.');

    let next = exc.prev_status;
    if (decision === 'APROVADA') {
      next = nextState(exc.prev_status, exc.type, { breaksUsed: s.breaks_used, breakCount: s.break_count });
      if (!next) fail(409, transitionError(exc.prev_status, exc.type, { breaksUsed: s.breaks_used, breakCount: s.break_count }));
      await applyEvent(tq, s, next, {
        type: exc.type, actorId: exc.requested_by, at: exc.requested_at, lat: exc.lat, lng: exc.lng, accuracy: exc.accuracy_m,
        distance: exc.distance_m, selfieKey: exc.selfie_key, selfieSha: exc.selfie_sha256, validation: 'EXCECAO_APROVADA',
        note: reason, exceptionId: exc.id,
      });
    } else {
      await tq('UPDATE work_sessions SET status = ? WHERE id = ?', [next, s.id]);
    }
    await tq('UPDATE presence_exceptions SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?', [decision, req.user.id, new Date(), reason, exc.id]);
    await audit(tq, req, 'EXCEPTION_DECIDE', 'presence_exception', exc.id, { before: { status: 'PENDENTE' }, after: { status: decision, session: next }, reason });
    return { status: next };
  });
  res.json(result);
});

// Checkout esquecido: o gestor encerra informando a origem do horário. Nunca vira checkout GPS.
r.post('/manage/sessions/:id/close', MANAGERS, async (req, res) => {
  const source = req.body.source;
  if (!CLOSURE_SOURCES.includes(source)) fail(400, 'Origem do horário inválida.');
  const reason = requireReason(req.body.reason);
  await tx(async (tq) => {
    const s = await loadManagedSession(tq, req.user, req.params.id);
    if (s.status !== 'PENDENTE_DE_FECHAMENTO') fail(409, 'Só atividades com checkout pendente podem ser encerradas pelo gestor.');
    const at = new Date(source === 'INFORMADO_PROFISSIONAL' ? s.reported_end_at : source === 'PREVISTO' ? s.ends_at : req.body.time);
    if (source === 'INFORMADO_PROFISSIONAL' && !s.reported_end_at) fail(409, 'O profissional ainda não informou o horário de saída.');
    if (Number.isNaN(+at) || at > new Date()) fail(400, 'Horário de encerramento inválido.');
    const [last] = await tq('SELECT MAX(occurred_at) AS t FROM presence_events WHERE work_session_id = ?', [s.id]);
    if (last.t && at <= new Date(last.t)) fail(400, 'O encerramento deve ser depois do último registro do profissional.');
    await applyEvent(tq, s, 'FINALIZADA', { type: 'CHECK_OUT', actorId: req.user.id, at, validation: 'FECHAMENTO_ADMINISTRATIVO', closureSource: source, note: reason });
    await audit(tq, req, 'SESSION_CLOSE', 'work_session', s.id, { after: { source, at }, reason });
  });
  res.json({ ok: true });
});

r.post('/manage/applications/:id/confirm', MANAGERS, async (req, res) => {
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
  const c = await tx(async (tq) => {
    try {
      await tq('INSERT INTO daily_confirmations (application_id, result, note, confirmed_by) VALUES (?,?,?,?)', [req.params.id, result, note, req.user.id]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') fail(409, 'Esta diária já foi confirmada.');
      throw e;
    }
    await audit(tq, req, 'DAILY_CONFIRM', 'application', req.params.id, { after: { result, note } });
    const pc = penaltyCtx(tq, req);
    if (result === 'NAO_COMPARECEU') {
      await createOccurrence(pc, {
        userId: s.user_id, unitId: s.unit_id, sessionId: s.id, applicationId: req.params.id, type: 'FALTA',
        description: note || 'Não compareceu (confirmado pelo gestor)', status: 'CONFIRMADA',
      });
    }
    return pc;
  });
  await flush(c);
  res.json({ ok: true });
});

// ---------- Varredura periódica ----------

// ponytail: roda via setInterval no processo do app; mover para o cron da Hostinger se o processo hibernar sem tráfego.
export async function sweep() {
  const now = new Date();

  // 1. Pausa vencida → PAUSA_EXCEDIDA + e-mail ao profissional.
  await q("UPDATE work_sessions SET status = 'PAUSA_EXCEDIDA' WHERE status = 'EM_PAUSA' AND break_ends_at < ?", [now]);
  // Ocorrência nasce PENDENTE: o gestor confirma ou cancela (pode ter sido falha técnica).
  await q(
    `INSERT IGNORE INTO occurrences (id, user_id, unit_id, work_session_id, application_id, type, description, status)
     SELECT UUID(), a.user_id, j.unit_id, ws.id, a.id, 'PAUSA_EXCEDIDA', 'Pausa passou do tempo configurado na vaga', 'PENDENTE'
     FROM work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id
     WHERE ws.status = 'PAUSA_EXCEDIDA'`,
  );
  const breaks = await q(
    `SELECT ws.id, w.email, w.name FROM work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN users w ON w.id = a.user_id
     WHERE ws.status = 'PAUSA_EXCEDIDA' AND ws.break_email_sent_at IS NULL`,
  );
  for (const d of breaks) {
    if (await sendMailSafe(d.email, 'UpService: sua pausa terminou', `Olá, ${d.name}.\n\nO tempo da sua pausa terminou. Abra o app UpService e registre o retorno.\n\nEste é um aviso automático.`)) {
      await q('UPDATE work_sessions SET break_email_sent_at = ? WHERE id = ?', [now, d.id]);
    }
  }

  // 2. Passou do término sem checkout → lembrete ao profissional e alerta aos gestores da unidade (uma vez).
  const late = await q(
    `${sessionSql('w.email, w.name AS worker_name,', 'JOIN users w ON w.id = a.user_id')}
     WHERE ws.status IN (?) AND j.ends_at < ? AND ws.checkout_reminder_at IS NULL`,
    [ACTIVE, now],
  );
  for (const s of late) {
    await sendMailSafe(s.email, 'UpService: faça seu checkout', `Olá, ${s.worker_name}.\n\nO horário da vaga "${s.title}" em ${s.unit_name} terminou e o checkout ainda não foi feito. Abra o app UpService e registre o checkout.\n\nEste é um aviso automático.`);
    for (const to of await managerEmails(q, s.unit_id)) {
      await sendMailSafe(to, `UpService: checkout pendente em ${s.unit_name}`, `${s.worker_name} ainda não fez checkout da vaga "${s.title}" em ${s.unit_name}. Após 30 minutos a atividade fica pendente de fechamento no painel Atividades.`);
    }
    await q('UPDATE work_sessions SET checkout_reminder_at = ? WHERE id = ?', [now, s.id]);
  }

  // 3. Tolerância de 30 min esgotada → PENDENTE_DE_FECHAMENTO (ocorrência CHECKOUT_AUSENTE na auditoria; punições no Marco 4).
  const missing = await q(`${SESSION_SQL} WHERE ws.status IN (?) AND j.ends_at < ?`, [ACTIVE, new Date(now.getTime() - CHECKOUT_TOLERANCE_MS)]);
  for (const s of missing) {
    const moved = await q("UPDATE work_sessions SET status = 'PENDENTE_DE_FECHAMENTO' WHERE id = ? AND status IN (?)", [s.id, ACTIVE]);
    if (moved.affectedRows) await audit(q, null, 'CHECKOUT_AUSENTE', 'work_session', s.id, { before: { status: s.status }, after: { status: 'PENDENTE_DE_FECHAMENTO' } });
  }
  await q(
    `INSERT IGNORE INTO occurrences (id, user_id, unit_id, work_session_id, application_id, type, description, status)
     SELECT UUID(), a.user_id, j.unit_id, ws.id, a.id, 'CHECKOUT_AUSENTE', 'Checkout não realizado até 30 minutos após o término', 'PENDENTE'
     FROM work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id
     WHERE ws.status = 'PENDENTE_DE_FECHAMENTO'`,
  );

  // 4. Bloqueio temporário vencido → reativação automática (v4.0 §4).
  for (const p of await q("SELECT * FROM penalties WHERE status = 'ATIVA' AND type = 'BLOQUEIO_TEMPORARIO' AND ends_at < ?", [now])) {
    const c = await tx(async (tq) => {
      const pc = penaltyCtx(tq, null);
      await endBlock(pc, p, 'ENCERRADA', 'Fim do prazo do bloqueio temporário');
      return pc;
    });
    await flush(c);
  }
}

export default r;
