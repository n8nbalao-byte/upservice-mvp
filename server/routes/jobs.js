// Vagas e candidaturas: vitrine do profissional e gestão pelo gestor/admin.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, int, num, requireReason, text } from '../http.js';
import { ctx, flush } from '../penalties.js';
import { byNearThenSoon, distanceMeters } from '../rules.js';
import { applyToJob, assertCanApprove, promoteFromWaitlist } from '../staffing.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');

// ---------- Profissional ----------

r.get('/jobs', requireRole('PROFISSIONAL'), async (req, res) => {
  const rows = await q(
    `SELECT j.id, j.title, j.description, j.starts_at, j.ends_at, j.positions, j.daily_value, j.break_count, j.break_minutes, j.is_cashier,
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
  if (hasHere) jobs.sort(byNearThenSoon);
  res.json(jobs);
});

// Sem aprovação manual: habilitado (documentos aprovados) entra direto; vaga cheia = reserva (ver staffing.js).
r.post('/jobs/:id/apply', requireRole('PROFISSIONAL'), async (req, res) => {
  try {
    const result = await tx(async (tq) => {
      // Trava a vaga: candidaturas simultâneas entram em fila e o limite de posições é respeitado.
      const [job] = await tq('SELECT j.id, j.status, j.positions, j.starts_at, j.ends_at, u.status AS unit_status FROM jobs j JOIN units u ON u.id = j.unit_id WHERE j.id = ? FOR UPDATE', [req.params.id]);
      if (!job || job.status !== 'ABERTA' || job.unit_status !== 'ATIVA' || new Date(job.starts_at) <= new Date()) fail(400, 'Vaga indisponível.');
      return applyToJob(ctx(tq, req), job, req.user.id);
    });
    res.status(201).json(result);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') fail(409, 'Você já se candidatou a esta vaga.');
    throw e;
  }
});

r.get('/me/applications', requireRole('PROFISSIONAL'), async (req, res) => {
  res.json(await q(
    `SELECT a.id, a.status, a.created_at, a.cancel_reason, a.decided_by IS NULL AS auto, j.title, j.starts_at, j.ends_at, j.daily_value,
            (SELECT COUNT(*) FROM applications r WHERE r.job_id = a.job_id AND r.status = 'PENDENTE'
               AND (r.created_at < a.created_at OR (r.created_at = a.created_at AND r.id <= a.id))) AS reserve_position,
            u.name AS unit_name, u.address AS unit_address, ws.id AS session_id, ws.status AS session_status, dc.result AS confirmation
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units u ON u.id = j.unit_id
     LEFT JOIN work_sessions ws ON ws.application_id = a.id
     LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
     WHERE a.user_id = ? ORDER BY j.starts_at DESC LIMIT 200`,
    [req.user.id],
  ));
});

const WITHDRAW_LIMIT_MS = 2 * 3600e3;

// Desistência: reserva a qualquer momento; diária aprovada até 2 h antes do início (a vaga vai para a reserva).
r.post('/me/applications/:id/cancel', requireRole('PROFISSIONAL'), async (req, res) => {
  const c = await tx(async (tq) => {
    const c = ctx(tq, req);
    const [a] = await tq(
      `SELECT a.id, a.status, a.job_id, j.starts_at, ws.id AS session_id, ws.status AS session_status
       FROM applications a JOIN jobs j ON j.id = a.job_id LEFT JOIN work_sessions ws ON ws.application_id = a.id
       WHERE a.id = ? AND a.user_id = ? FOR UPDATE`,
      [req.params.id, req.user.id],
    );
    if (!a || !['PENDENTE', 'APROVADA'].includes(a.status)) fail(409, 'Esta candidatura não pode mais ser cancelada.');
    if (a.status === 'APROVADA') {
      if (a.session_status !== 'AGUARDANDO_CHECKIN' || new Date(a.starts_at) - Date.now() < WITHDRAW_LIMIT_MS) {
        fail(409, 'Faltam menos de 2 horas para o início: fale com a loja para desistir.');
      }
      await tq("UPDATE work_sessions SET status = 'CANCELADA_ADMINISTRATIVAMENTE' WHERE id = ?", [a.session_id]);
    }
    await tq("UPDATE applications SET status = 'CANCELADA', cancel_reason = 'Desistência do profissional' WHERE id = ?", [a.id]);
    await audit(tq, req, 'APPLICATION_WITHDRAW', 'application', a.id, { before: { status: a.status }, after: { status: 'CANCELADA' } });
    if (a.status === 'APROVADA') await promoteFromWaitlist(c, a.job_id);
    return c;
  });
  await flush(c);
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

/** Validação única de uma vaga (cadastro manual e importação da escala). */
function buildJob(req, b, unitId) {
  const startsAt = new Date(b.startsAt);
  const endsAt = new Date(b.endsAt);
  if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt)) fail(400, 'Informe início e término.');
  if (startsAt < new Date()) fail(400, 'O início da vaga já passou.');
  if (endsAt <= startsAt || endsAt - startsAt > 24 * 3600e3) fail(400, 'Término deve ser depois do início, em até 24 horas.');
  return {
    id: randomUUID(),
    unit_id: unitId,
    title: text(b.title, 'título', { min: 3, max: 120 }),
    description: text(b.description, 'descrição', { max: 1000, optional: true }),
    starts_at: startsAt,
    ends_at: endsAt,
    positions: int(b.positions, 'quantidade de posições', 1, 500),
    daily_value: Math.round(num(b.dailyValue, 'valor da diária', 0, 100000) * 100) / 100,
    break_count: int(b.breakCount, 'quantidade de pausas', 0, 3),
    break_minutes: int(b.breakMinutes, 'duração da pausa', 1, 120),
    // Vaga de caixa: pode haver quebra de caixa ao fim do expediente. Sem escolha explícita, "caixa" no título marca.
    is_cashier: (b.isCashier === undefined ? /\bcaixa\b/i.test(String(b.title ?? '')) : b.isCashier === true) ? 1 : 0,
    status: b.publish ? 'ABERTA' : 'RASCUNHO',
    created_by: req.user.id,
  };
}

r.post('/manage/jobs', MANAGERS, async (req, res) => {
  const b = req.body;
  await assertUnit(req.user, b.unitId);
  const job = buildJob(req, b, b.unitId);
  const [unit] = await q('SELECT status FROM units WHERE id = ?', [b.unitId]);
  if (unit?.status !== 'ATIVA') fail(409,'Unidade bloqueada ou inativa: não recebe novas vagas.');
  await q('INSERT INTO jobs SET ?', [job]);
  await audit(q, req, 'JOB_CREATE', 'job', job.id, { after: job });
  res.status(201).json({ id: job.id });
});

const IMPORT_MAX = 5000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISSUE = {
  FILIAL_DESCONHECIDA: 'Filial não cadastrada (ou fora do seu acesso)', LOJA_INATIVA: 'Loja bloqueada ou inativa',
  DATA_INVALIDA: 'Data inválida', QUANTIDADE_INVALIDA: 'Quantidade inválida', DATA_PASSADA: 'Dia que já passou',
  JA_EXISTE: 'Vaga já existe', REPETIDA: 'Repetida na planilha',
};

/**
 * Importação da escala mensal: uma vaga por loja (nº da filial) e dia, com a quantidade da planilha e os padrões
 * informados (função, horário, valor, pausas). dryRun = prévia sem gravar; senão cria tudo numa transação.
 */
r.post('/manage/jobs/import', MANAGERS, async (req, res) => {
  const d = req.body.defaults ?? {};
  const items = Array.isArray(req.body.items) ? req.body.items : fail(400, 'Planilha sem linhas.');
  if (!items.length || items.length > IMPORT_MAX) fail(400, `A importação aceita de 1 a ${IMPORT_MAX} linhas.`);
  if (!HHMM.test(d.startTime ?? '') || !HHMM.test(d.endTime ?? '')) fail(400, 'Informe o horário de início e de término.');
  const title = text(d.title, 'função', { min: 3, max: 120 });
  const digits = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

  const filiais = [...new Set(items.map((i) => digits(i.filial)).filter(Boolean))];
  const units = filiais.length ? await q('SELECT id, code, name, status, filial FROM units WHERE filial IN (?)', [filiais]) : [];
  const byFilial = new Map(units.map((u) => [u.filial, u]));
  const allowed = req.user.role === 'ADMINISTRADOR' ? null
    : new Set((await q('SELECT unit_id FROM unit_managers WHERE user_id = ? AND active = 1', [req.user.id])).map((x) => x.unit_id));

  const now = new Date();
  const seen = new Set();
  const lines = items.map((i) => {
    const filial = digits(i.filial);
    // Loja fora do acesso do gestor é tratada como desconhecida: a prévia não revela código nem nome (como o 404 de assertUnit).
    const found = byFilial.get(filial);
    const unit = found && (!allowed || allowed.has(found.id)) ? found : null;
    const line = { filial, name: String(i.name ?? '').slice(0, 120), date: String(i.date ?? ''), positions: Number(i.positions), unit };
    if (!unit) return { ...line, issue: 'FILIAL_DESCONHECIDA' };
    if (unit.status !== 'ATIVA') return { ...line, issue: 'LOJA_INATIVA' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(line.date)) return { ...line, issue: 'DATA_INVALIDA' };
    if (!Number.isInteger(line.positions) || line.positions < 1 || line.positions > 500) return { ...line, issue: 'QUANTIDADE_INVALIDA' };
    const startsAt = new Date(`${line.date}T${d.startTime}:00-03:00`);
    let endsAt = new Date(`${line.date}T${d.endTime}:00-03:00`);
    if (Number.isNaN(+startsAt)) return { ...line, issue: 'DATA_INVALIDA' };
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400e3); // turno que vira a noite
    if (startsAt <= now) return { ...line, issue: 'DATA_PASSADA' };
    const key = `${unit.id}|${+startsAt}`;
    if (seen.has(key)) return { ...line, issue: 'REPETIDA' };
    seen.add(key);
    return { ...line, key, startsAt, endsAt };
  });

  // Mesma loja, mesmo início e mesma função já cadastrada (e não cancelada): não duplica.
  const ok = lines.filter((l) => !l.issue);
  if (ok.length) {
    const times = ok.map((l) => +l.startsAt);
    const existing = await q(
      "SELECT unit_id, starts_at FROM jobs WHERE unit_id IN (?) AND title = ? AND status <> 'CANCELADA' AND starts_at BETWEEN ? AND ?",
      [[...new Set(ok.map((l) => l.unit.id))], title, new Date(Math.min(...times)), new Date(Math.max(...times))],
    );
    const taken = new Set(existing.map((j) => `${j.unit_id}|${+new Date(j.starts_at)}`));
    for (const l of ok) if (taken.has(l.key)) l.issue = 'JA_EXISTE';
  }
  const jobs = lines.filter((l) => !l.issue).map((l) => buildJob(req, {
    title, description: d.description, startsAt: l.startsAt, endsAt: l.endsAt, positions: l.positions,
    dailyValue: d.dailyValue, breakCount: d.breakCount, breakMinutes: d.breakMinutes, publish: d.publish, isCashier: d.isCashier,
  }, l.unit.id));

  const stores = new Map();
  for (const l of lines) {
    const st = stores.get(l.filial) ?? { filial: l.filial, name: l.name, unit: l.unit ? { code: l.unit.code, name: l.unit.name } : null, days: 0, positions: 0, issues: {} };
    if (l.issue) st.issues[l.issue] = (st.issues[l.issue] ?? 0) + 1;
    else { st.days += 1; st.positions += l.positions; }
    stores.set(l.filial, st);
  }
  const issues = {};
  for (const l of lines) if (l.issue) issues[l.issue] = (issues[l.issue] ?? 0) + 1;
  const summary = { lines: lines.length, jobs: jobs.length, positions: jobs.reduce((t, j) => t + j.positions, 0), issues };

  if (!req.body.dryRun && jobs.length) {
    const cols = Object.keys(jobs[0]);
    await tx(async (tq) => {
      for (let i = 0; i < jobs.length; i += 500) {
        await tq(`INSERT INTO jobs (${cols.join(',')}) VALUES ?`, [jobs.slice(i, i + 500).map((j) => cols.map((c) => j[c]))]);
      }
      await audit(tq, req, 'JOBS_IMPORT', 'job', null, { after: { title, defaults: d, ...summary, from: lines[0]?.date } });
    });
  }
  res.json({ dryRun: !!req.body.dryRun, created: req.body.dryRun ? 0 : jobs.length, summary, labels: ISSUE, stores: [...stores.values()] });
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
    `SELECT a.id, a.status, a.created_at, a.cancel_reason, a.user_id, a.decided_by IS NULL AS auto, u.name, p.phone, p.city, p.uf,
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
    const [job] = await tq('SELECT j.id, j.status, j.positions, j.starts_at, j.ends_at, u.status AS unit_status FROM jobs j JOIN units u ON u.id = j.unit_id WHERE j.id = ? FOR UPDATE', [job_id]);
    const [app] = await tq('SELECT status, user_id FROM applications WHERE id = ? FOR UPDATE', [id]);
    if (app.status !== 'PENDENTE') fail(409, 'Esta candidatura já foi decidida.');
    if (decision === 'APROVADA') {
      if (job.status !== 'ABERTA') fail(409, 'A vaga não está aberta.');
      if (job.unit_status !== 'ATIVA') fail(409, 'Unidade bloqueada ou inativa.');
      await assertCanApprove(tq, app.user_id, job);
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
  const { id, job_id } = await loadApplication(req);
  const c = await tx(async (tq) => {
    const c = ctx(tq, req);
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
    await promoteFromWaitlist(c, job_id);
    return c;
  });
  await flush(c);
  res.json({ ok: true });
});

export default r;
