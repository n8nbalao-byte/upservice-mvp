// Vagas e candidaturas: vitrine do profissional e gestão pelo gestor/admin.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, int, num, requireReason, text } from '../http.js';
import { distanceMeters } from '../rules.js';
import { profileState } from './worker.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');

// ---------- Profissional ----------

r.get('/jobs', requireRole('PROFISSIONAL'), async (req, res) => {
  const rows = await q(
    `SELECT j.id, j.title, j.description, j.starts_at, j.ends_at, j.positions, j.daily_value, j.break_count, j.break_minutes,
            u.name AS unit_name, u.address AS unit_address, u.lat, u.lng,
            (SELECT COUNT(*) FROM applications x WHERE x.job_id = j.id AND x.status = 'APROVADA') AS approved,
            (SELECT y.status FROM applications y WHERE y.job_id = j.id AND y.user_id = ?) AS my_status
     FROM jobs j JOIN units u ON u.id = j.unit_id
     WHERE j.status = 'ABERTA' AND u.status = 'ATIVA' AND j.starts_at > ?
     ORDER BY j.starts_at LIMIT 500`,
    [req.user.id, new Date()],
  );
  // A localização do profissional só ordena a lista; não é gravada.
  const here = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
  const hasHere = Number.isFinite(here.lat) && Number.isFinite(here.lng) && req.query.lat !== '' && req.query.lng !== '';
  const jobs = rows.map(({ lat, lng, approved, positions, ...j }) => ({
    ...j,
    available: Math.max(0, positions - approved),
    distance_m: hasHere ? Math.round(distanceMeters(here, { lat, lng })) : null,
  }));
  // ponytail: ordenação em memória; mover para SQL se passar de alguns milhares de vagas abertas.
  if (hasHere) jobs.sort((a, b) => a.distance_m - b.distance_m);
  res.json(jobs);
});

r.post('/jobs/:id/apply', requireRole('PROFISSIONAL'), async (req, res) => {
  if (req.user.status !== 'ATIVO') fail(403, 'Sua conta não está liberada para candidaturas.');
  if (!(await profileState(req.user.id)).complete) fail(400, 'Complete seu cadastro antes de se candidatar.');
  const [job] = await q('SELECT j.status, u.status AS unit_status FROM jobs j JOIN units u ON u.id = j.unit_id WHERE j.id = ?', [req.params.id]);
  if (!job || job.status !== 'ABERTA' || job.unit_status !== 'ATIVA') fail(400, 'Vaga indisponível.');
  const id = randomUUID();
  try {
    await q('INSERT INTO applications (id, job_id, user_id) VALUES (?,?,?)', [id, req.params.id, req.user.id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') fail(409, 'Você já se candidatou a esta vaga.');
    throw e;
  }
  await audit(q, req, 'APPLICATION_CREATE', 'application', id);
  res.status(201).json({ id });
});

r.get('/me/applications', requireRole('PROFISSIONAL'), async (req, res) => {
  res.json(await q(
    `SELECT a.id, a.status, a.created_at, a.cancel_reason, j.title, j.starts_at, j.ends_at, j.daily_value,
            u.name AS unit_name, u.address AS unit_address, ws.id AS session_id, ws.status AS session_status, dc.result AS confirmation
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units u ON u.id = j.unit_id
     LEFT JOIN work_sessions ws ON ws.application_id = a.id
     LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
     WHERE a.user_id = ? ORDER BY j.starts_at DESC LIMIT 200`,
    [req.user.id],
  ));
});

r.post('/me/applications/:id/cancel', requireRole('PROFISSIONAL'), async (req, res) => {
  const result = await q("UPDATE applications SET status = 'CANCELADA' WHERE id = ? AND user_id = ? AND status = 'PENDENTE'", [req.params.id, req.user.id]);
  if (!result.affectedRows) fail(409, 'Só é possível cancelar candidaturas pendentes.');
  await audit(q, req, 'APPLICATION_WITHDRAW', 'application', req.params.id);
  res.json({ ok: true });
});

// ---------- Gestão ----------

r.get('/manage/jobs', MANAGERS, async (req, res) => {
  await assertUnit(req.user, req.query.unitId);
  res.json(await q(
    `SELECT j.*,
            (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'PENDENTE') AS pending,
            (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'APROVADA') AS approved
     FROM jobs j WHERE j.unit_id = ? ORDER BY j.starts_at DESC LIMIT 300`,
    [req.query.unitId],
  ));
});

r.post('/manage/jobs', MANAGERS, async (req, res) => {
  const b = req.body;
  await assertUnit(req.user, b.unitId);
  const startsAt = new Date(b.startsAt);
  const endsAt = new Date(b.endsAt);
  if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt)) fail(400, 'Informe início e término.');
  if (startsAt < new Date()) fail(400, 'O início da vaga já passou.');
  if (endsAt <= startsAt || endsAt - startsAt > 24 * 3600e3) fail(400, 'Término deve ser depois do início, em até 24 horas.');
  const job = {
    id: randomUUID(),
    unit_id: b.unitId,
    title: text(b.title, 'título', { min: 3, max: 120 }),
    description: text(b.description, 'descrição', { max: 1000, optional: true }),
    starts_at: startsAt,
    ends_at: endsAt,
    positions: int(b.positions, 'quantidade de posições', 1, 500),
    daily_value: Math.round(num(b.dailyValue, 'valor da diária', 0, 100000) * 100) / 100,
    break_count: int(b.breakCount, 'quantidade de pausas', 0, 3),
    break_minutes: int(b.breakMinutes, 'duração da pausa', 1, 120),
    status: b.publish ? 'ABERTA' : 'RASCUNHO',
    created_by: req.user.id,
  };
  const [unit] = await q('SELECT status FROM units WHERE id = ?', [b.unitId]);
  if (unit?.status !== 'ATIVA') fail(409,'Unidade bloqueada ou inativa: não recebe novas vagas.');
  await q('INSERT INTO jobs SET ?', [job]);
  await audit(q, req, 'JOB_CREATE', 'job', job.id, { after: job });
  res.status(201).json({ id: job.id });
});

const JOB_TRANSITIONS = {
  'RASCUNHO>ABERTA': true,
  'RASCUNHO>CANCELADA': true,
  'ABERTA>ENCERRADA': true,
  'ABERTA>CANCELADA': true,
  'ENCERRADA>ABERTA': 'ADMINISTRADOR',
};

r.post('/manage/jobs/:id/status', MANAGERS, async (req, res) => {
  const [job] = await q('SELECT j.*, u.status AS unit_status FROM jobs j JOIN units u ON u.id = j.unit_id WHERE j.id = ?', [req.params.id]);
  if (!job) fail(404, 'Não encontrado.');
  await assertUnit(req.user, job.unit_id);
  const to = req.body.status;
  const rule = JOB_TRANSITIONS[`${job.status}>${to}`];
  if (!rule || (rule !== true && req.user.role !== rule)) fail(409, `Não é possível mudar a vaga de ${job.status} para ${to}.`);
  if (to === 'ABERTA' && job.unit_status !== 'ATIVA') fail(409, 'Unidade bloqueada ou inativa.');
  await q('UPDATE jobs SET status = ? WHERE id = ?', [to, job.id]);
  await audit(q, req, 'JOB_STATUS', 'job', job.id, { before: { status: job.status }, after: { status: to } });
  res.json({ ok: true });
});

r.get('/manage/jobs/:id/applications', MANAGERS, async (req, res) => {
  const [job] = await q('SELECT j.*, u.name AS unit_name FROM jobs j JOIN units u ON u.id = j.unit_id WHERE j.id = ?', [req.params.id]);
  if (!job) fail(404, 'Não encontrado.');
  await assertUnit(req.user, job.unit_id);
  const applications = await q(
    `SELECT a.id, a.status, a.created_at, a.cancel_reason, a.user_id, u.name, p.phone, p.city, p.uf,
            (SELECT COUNT(*) FROM worker_documents d WHERE d.user_id = a.user_id AND d.status = 'APROVADO') AS docs_approved,
            ws.id AS session_id, ws.status AS session_status, dc.result AS confirmation
     FROM applications a JOIN users u ON u.id = a.user_id
     LEFT JOIN worker_profiles p ON p.user_id = a.user_id
     LEFT JOIN work_sessions ws ON ws.application_id = a.id
     LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
     WHERE a.job_id = ? ORDER BY a.created_at`,
    [job.id],
  );
  res.json({ job, applications });
});

async function loadApplication(req) {
  const [app] = await q('SELECT a.id, a.job_id, j.unit_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?', [req.params.id]);
  if (!app) fail(404, 'Não encontrado.');
  await assertUnit(req.user, app.unit_id);
  return app;
}

r.post('/manage/applications/:id/decide', MANAGERS, async (req, res) => {
  const decision = req.body.decision;
  if (decision !== 'APROVADA' && decision !== 'RECUSADA') fail(400, 'Decisão inválida.');
  const { id, job_id } = await loadApplication(req);
  await tx(async (tq) => {
    // Trava a vaga primeiro: aprovações concorrentes da mesma vaga ficam em fila e o limite de posições é respeitado.
    const [job] = await tq('SELECT status, positions FROM jobs WHERE id = ? FOR UPDATE', [job_id]);
    const [app] = await tq('SELECT status FROM applications WHERE id = ? FOR UPDATE', [id]);
    if (app.status !== 'PENDENTE') fail(409, 'Esta candidatura já foi decidida.');
    if (decision === 'APROVADA') {
      if (job.status !== 'ABERTA') fail(409, 'A vaga não está aberta.');
      const [{ n }] = await tq("SELECT COUNT(*) AS n FROM applications WHERE job_id = ? AND status = 'APROVADA'", [job_id]);
      if (n >= job.positions) fail(409, 'Todas as posições desta vaga já foram preenchidas.');
      await tq('INSERT INTO work_sessions (id, application_id) VALUES (?,?)', [randomUUID(), id]);
    }
    await tq('UPDATE applications SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?', [decision, req.user.id, new Date(), id]);
    await audit(tq, req, 'APPLICATION_DECIDE', 'application', id, { before: { status: 'PENDENTE' }, after: { status: decision } });
  });
  res.json({ ok: true });
});

// Decisão da UpService: só o gestor da unidade cancela aprovação; administrador não, pelo fluxo normal.
r.post('/manage/applications/:id/cancel', requireRole('GESTOR'), async (req, res) => {
  const reason = requireReason(req.body.reason);
  const { id } = await loadApplication(req);
  await tx(async (tq) => {
    const [app] = await tq(
      `SELECT a.status, ws.id AS session_id, ws.status AS session_status, dc.result
       FROM applications a JOIN work_sessions ws ON ws.application_id = a.id
       LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
       WHERE a.id = ? FOR UPDATE`,
      [id],
    );
    if (!app || app.status !== 'APROVADA') fail(409, 'Só candidaturas aprovadas podem ser canceladas.');
    if (app.result) fail(409, 'A diária já foi confirmada; não é possível cancelar.');
    if (app.session_status !== 'AGUARDANDO_CHECKIN') fail(409, 'A atividade já começou; não é possível cancelar.');
    await tq("UPDATE applications SET status = 'CANCELADA', cancel_reason = ? WHERE id = ?", [reason, id]);
    await tq("UPDATE work_sessions SET status = 'CANCELADA_ADMINISTRATIVAMENTE' WHERE id = ?", [app.session_id]);
    await audit(tq, req, 'APPLICATION_CANCEL', 'application', id, { before: { status: 'APROVADA' }, after: { status: 'CANCELADA' }, reason });
  });
  res.json({ ok: true });
});

export default r;
