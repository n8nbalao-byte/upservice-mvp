// Ocorrências, bloqueios, contestações e a central de pendências do gestor/admin.
import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole, unitScope, workerAllowed, workerScope } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, requireReason, text } from '../http.js';
import { applyBlock, createOccurrence, ctx, decideOccurrence, endBlock, flush } from '../penalties.js';
import { STRIKES_TO_BLOCK, isStrike } from '../rules.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
const MANUAL_TYPES = ['ABANDONO', 'FRAUDE', 'REGRA_OPERACIONAL'];


/**
 * Quem pode reverter um bloqueio: admin sempre; gestor só o que ele mesmo aplicou ou o bloqueio automático
 * (3 faltas) que envolve falta de loja dele. Bloqueio do admin ou de outro gestor não é revertido por gestor.
 */
async function assertPenaltyAuthority(tq, user, p) {
  if (user.role === 'ADMINISTRADOR' || p.created_by === user.id) return;
  if (p.created_by === null) {
    const [own] = await tq(
      `SELECT 1 FROM occurrences o JOIN unit_managers m ON m.unit_id = o.unit_id AND m.active = 1
       WHERE o.penalty_id = ? AND m.user_id = ? LIMIT 1`,
      [p.id, user.id],
    );
    if (own) return;
  }
  fail(403, 'Este bloqueio foi aplicado por outra pessoa; só ela ou um administrador pode revertê-lo.');
}

/** Tudo o que a pessoa vê sobre si: ocorrências confirmadas/canceladas, bloqueios e contestações. */
async function history(userId, { includePending = false } = {}) {
  const [occurrences, penalties, contestations] = await Promise.all([
    q(`SELECT o.*, un.name AS unit_name FROM occurrences o JOIN units un ON un.id = o.unit_id
       WHERE o.user_id = ? ${includePending ? '' : "AND o.status <> 'PENDENTE'"} ORDER BY o.created_at DESC`, [userId]),
    q('SELECT * FROM penalties WHERE user_id = ? ORDER BY created_at DESC', [userId]),
    q('SELECT * FROM contestations WHERE user_id = ? ORDER BY created_at DESC', [userId]),
  ]);
  return { occurrences, penalties, contestations, strikes: occurrences.filter(isStrike).length, strikesToBlock: STRIKES_TO_BLOCK };
}

const protocol = () => `CT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(2).toString('hex').toUpperCase()}`;

/** Valida o item contestado (do próprio profissional, ativo/confirmado, sem contestação aberta) e cria o protocolo. */
async function openContestation(req, { userId, penaltyId, occurrenceId, message, channel }) {
  if (!penaltyId === !occurrenceId) fail(400, 'Informe o bloqueio ou a ocorrência contestada.');
  const msg = text(message, 'mensagem', { min: 10, max: 1000 });
  return tx(async (tq) => {
    if (penaltyId) {
      const [p] = await tq('SELECT status FROM penalties WHERE id = ? AND user_id = ?', [penaltyId, userId]);
      if (!p) fail(404, 'Não encontrado.');
      if (p.status !== 'ATIVA') fail(409, 'Só é possível contestar um bloqueio ativo.');
    } else {
      const [o] = await tq('SELECT status FROM occurrences WHERE id = ? AND user_id = ?', [occurrenceId, userId]);
      if (!o) fail(404, 'Não encontrado.');
      if (o.status !== 'CONFIRMADA') fail(409, 'Só é possível contestar uma ocorrência confirmada.');
    }
    const [open] = await tq("SELECT protocol FROM contestations WHERE (penalty_id = ? OR occurrence_id = ?) AND status = 'ABERTA' FOR UPDATE", [penaltyId ?? '', occurrenceId ?? '']);
    if (open) fail(409, `Já existe uma contestação em análise (protocolo ${open.protocol}).`);
    const c = { id: randomUUID(), protocol: protocol(), user_id: userId, penalty_id: penaltyId ?? null, occurrence_id: occurrenceId ?? null, channel, message: msg, created_by: req.user.id };
    await tq('INSERT INTO contestations SET ?', [c]);
    await audit(tq, req, 'CONTESTATION_OPEN', 'contestation', c.id, { after: { protocol: c.protocol, channel, penaltyId, occurrenceId } });
    return c;
  });
}

// ---------- Profissional (inclusive bloqueado) ----------

r.get('/me/occurrences', requireRole('PROFISSIONAL'), async (req, res) => res.json(await history(req.user.id)));

// O bloqueio não é suspenso pela contestação (v4.0 §6); a análise é prioritária.
r.post('/me/contestations', requireRole('PROFISSIONAL'), async (req, res) => {
  const c = await openContestation(req, { userId: req.user.id, penaltyId: req.body.penaltyId, occurrenceId: req.body.occurrenceId, message: req.body.message, channel: 'APP' });
  res.status(201).json({ protocol: c.protocol });
});

// ---------- Gestão ----------

r.get('/manage/workers/:id/penalties', MANAGERS, async (req, res) => {
  if (!(await workerAllowed(req.user, req.params.id))) fail(404, 'Não encontrado.');
  res.json(await history(req.params.id, { includePending: true }));
});

r.get('/manage/occurrences', MANAGERS, async (req, res) => {
  const [oWhere, oArgs] = unitScope(req.user, 'o.unit_id');
  const [cWhere, cArgs] = workerScope(req.user, 'c.user_id');
  const [pWhere, pArgs] = workerScope(req.user, 'p.user_id');
  const [occurrences, contestations, penalties] = await Promise.all([
    q(`SELECT o.*, u.name AS worker_name, un.name AS unit_name FROM occurrences o JOIN users u ON u.id = o.user_id JOIN units un ON un.id = o.unit_id
       WHERE o.status = 'PENDENTE' AND ${oWhere} ORDER BY o.created_at LIMIT 200`, oArgs),
    q(`SELECT c.*, u.name AS worker_name, p.type AS penalty_type, p.reason AS penalty_reason, p.ends_at AS penalty_ends_at, o.type AS occurrence_type, o.description AS occurrence_description
       FROM contestations c JOIN users u ON u.id = c.user_id LEFT JOIN penalties p ON p.id = c.penalty_id LEFT JOIN occurrences o ON o.id = c.occurrence_id
       WHERE c.status = 'ABERTA' AND ${cWhere} ORDER BY c.created_at LIMIT 200`, cArgs),
    q(`SELECT p.*, u.name AS worker_name FROM penalties p JOIN users u ON u.id = p.user_id
       WHERE p.status = 'ATIVA' AND ${pWhere} ORDER BY p.created_at DESC LIMIT 200`, pArgs),
  ]);
  res.json({ occurrences, contestations, penalties });
});

r.post('/manage/occurrences', MANAGERS, async (req, res) => {
  const { userId, unitId, type } = req.body;
  if (!MANUAL_TYPES.includes(type)) fail(400, 'Tipo de ocorrência inválido.');
  const description = requireReason(req.body.description);
  if (!(await workerAllowed(req.user, userId))) fail(404, 'Não encontrado.');
  await assertUnit(req.user, unitId);
  const c = await tx(async (tq) => {
    const c = ctx(tq, req);
    await createOccurrence(c, { userId, unitId, type, description, status: 'CONFIRMADA' });
    return c;
  });
  await flush(c);
  res.status(201).json({ ok: true });
});

r.post('/manage/occurrences/:id/decide', MANAGERS, async (req, res) => {
  const decision = req.body.decision;
  if (decision !== 'CONFIRMADA' && decision !== 'CANCELADA') fail(400, 'Decisão inválida.');
  const reason = requireReason(req.body.reason);
  const c = await tx(async (tq) => {
    const [occ] = await tq('SELECT * FROM occurrences WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!occ) fail(404, 'Não encontrado.');
    await assertUnit(req.user, occ.unit_id);
    if (occ.status !== 'PENDENTE') fail(409, 'Esta ocorrência já foi analisada.');
    const c = ctx(tq, req);
    await decideOccurrence(c, occ, decision, reason);
    return c;
  });
  await flush(c);
  res.json({ ok: true });
});

// Bloqueio permanente: só manual, com justificativa e confirmação digitada (v4.0 §5).
r.post('/manage/workers/:id/block', MANAGERS, async (req, res) => {
  const reason = requireReason(req.body.reason);
  if (req.body.confirm !== 'BLOQUEAR') fail(400, 'Para confirmar, digite BLOQUEAR.');
  if (!(await workerAllowed(req.user, req.params.id))) fail(404, 'Não encontrado.');
  const c = await tx(async (tq) => {
    const [w] = await tq('SELECT role FROM users WHERE id = ? FOR UPDATE', [req.params.id]);
    if (w?.role !== 'PROFISSIONAL') fail(404, 'Não encontrado.');
    const [already] = await tq("SELECT 1 FROM penalties WHERE user_id = ? AND type = 'BLOQUEIO_PERMANENTE' AND status = 'ATIVA'", [req.params.id]);
    if (already) fail(409, 'Este profissional já está bloqueado permanentemente.');
    const c = ctx(tq, req);
    await applyBlock(c, { userId: req.params.id, type: 'BLOQUEIO_PERMANENTE', reason });
    return c;
  });
  await flush(c);
  res.json({ ok: true });
});

r.post('/manage/penalties/:id/end', MANAGERS, async (req, res) => {
  const reason = requireReason(req.body.reason);
  const c = await tx(async (tq) => {
    const [p] = await tq('SELECT * FROM penalties WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!p || !(await workerAllowed(req.user, p.user_id))) fail(404, 'Não encontrado.');
    if (p.status !== 'ATIVA') fail(409, 'Este bloqueio não está ativo.');
    await assertPenaltyAuthority(tq, req.user, p);
    const c = ctx(tq, req);
    await endBlock(c, p, 'ENCERRADA', reason);
    return c;
  });
  await flush(c);
  res.json({ ok: true });
});

// Contestação recebida por e-mail: o gestor registra no sistema (v4.0 §6).
r.post('/manage/contestations', MANAGERS, async (req, res) => {
  const { userId, penaltyId, occurrenceId, message } = req.body;
  if (!(await workerAllowed(req.user, userId))) fail(404, 'Não encontrado.');
  const c = await openContestation(req, { userId, penaltyId, occurrenceId, message, channel: 'EMAIL' });
  res.status(201).json({ protocol: c.protocol });
});

r.post('/manage/contestations/:id/decide', MANAGERS, async (req, res) => {
  const decision = req.body.decision;
  if (!['MANTIDA', 'CANCELADA', 'AJUSTADA'].includes(decision)) fail(400, 'Decisão inválida.');
  const reason = requireReason(req.body.reason);
  const c = await tx(async (tq) => {
    const [ct] = await tq('SELECT * FROM contestations WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!ct || !(await workerAllowed(req.user, ct.user_id))) fail(404, 'Não encontrado.');
    if (ct.status !== 'ABERTA') fail(409, 'Esta contestação já foi decidida.');
    const c = ctx(tq, req);
    const [p] = ct.penalty_id ? await tq('SELECT * FROM penalties WHERE id = ? FOR UPDATE', [ct.penalty_id]) : [];
    const [o] = ct.occurrence_id ? await tq('SELECT * FROM occurrences WHERE id = ? FOR UPDATE', [ct.occurrence_id]) : [];
    if (p) await assertPenaltyAuthority(tq, req.user, p);
    if (o) await assertUnit(req.user, o.unit_id);
    let newEndsAt = null;
    if (decision === 'CANCELADA') {
      if (p?.status === 'ATIVA') await endBlock(c, p, 'CANCELADA', `Contestação ${ct.protocol} aceita: ${reason}`);
      if (o && o.status !== 'CANCELADA') await decideOccurrence(c, o, 'CANCELADA', `Contestação ${ct.protocol} aceita: ${reason}`);
    } else if (decision === 'AJUSTADA') {
      if (p?.type !== 'BLOQUEIO_TEMPORARIO' || p.status !== 'ATIVA') fail(400, 'Ajuste só vale para bloqueio temporário ativo (novo prazo).');
      newEndsAt = new Date(req.body.newEndsAt);
      if (Number.isNaN(+newEndsAt)) fail(400, 'Informe o novo fim do bloqueio.');
      if (newEndsAt <= new Date()) await endBlock(c, p, 'ENCERRADA', `Contestação ${ct.protocol}: prazo reduzido`);
      else await tq('UPDATE penalties SET ends_at = ? WHERE id = ?', [newEndsAt, p.id]);
    }
    await tq('UPDATE contestations SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, new_ends_at = ? WHERE id = ?', [decision, req.user.id, new Date(), reason, newEndsAt, ct.id]);
    await audit(tq, req, 'CONTESTATION_DECIDE', 'contestation', ct.id, { before: { status: 'ABERTA' }, after: { status: decision, newEndsAt }, reason });
    const [w] = await tq('SELECT email, name FROM users WHERE id = ?', [ct.user_id]);
    const result = { MANTIDA: 'mantida', CANCELADA: 'aceita: a punição foi cancelada', AJUSTADA: 'aceita em parte: o prazo do bloqueio foi ajustado' }[decision];
    c.outbox.push([w.email, `UpService: contestação ${ct.protocol} analisada`, `Olá, ${w.name}.\n\nSua contestação ${ct.protocol} foi ${result}.\nJustificativa: ${reason}`]);
    return c;
  });
  await flush(c);
  res.json({ ok: true });
});

// ---------- Central de pendências (o painel consulta a cada 30 s) ----------

r.get('/manage/inbox', MANAGERS, async (req, res) => {
  const [uWhere, uArgs] = unitScope(req.user, 'j.unit_id');
  const [wWhere, wArgs] = workerScope(req.user, 'd.user_id');
  const [oWhere, oArgs] = unitScope(req.user, 'o.unit_id');
  const [cWhere, cArgs] = workerScope(req.user, 'c.user_id');
  const day = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const [exceptions, closures, applications, documents, occurrences, contestations, alerts] = await Promise.all([
    q(`SELECT x.id, x.type, x.reason, x.requested_at AS at, w.name, j.unit_id, j.starts_at, un.name AS unit_name FROM presence_exceptions x
       JOIN work_sessions ws ON ws.id = x.work_session_id JOIN applications a ON a.id = ws.application_id JOIN users w ON w.id = a.user_id
       JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id WHERE x.status = 'PENDENTE' AND ${uWhere}`, uArgs),
    q(`SELECT ws.id, j.ends_at AS at, w.name, j.unit_id, j.starts_at, un.name AS unit_name FROM work_sessions ws
       JOIN applications a ON a.id = ws.application_id JOIN users w ON w.id = a.user_id JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id
       WHERE ws.status = 'PENDENTE_DE_FECHAMENTO' AND ${uWhere}`, uArgs),
    q(`SELECT j.id, j.title, j.starts_at, un.name AS unit_name, COUNT(*) AS n, MIN(a.created_at) AS at FROM applications a
       JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id
       WHERE a.status = 'PENDENTE' AND j.status = 'ABERTA' AND j.starts_at > ? AND ${uWhere} GROUP BY j.id, j.title, j.starts_at, un.name`, [new Date(), ...uArgs]),
    q(`SELECT d.user_id AS id, u.name, COUNT(*) AS n, MIN(d.created_at) AS at FROM worker_documents d JOIN users u ON u.id = d.user_id
       WHERE d.status = 'PENDENTE' AND ${wWhere} GROUP BY d.user_id, u.name`, wArgs),
    q(`SELECT o.id, o.type, o.created_at AS at, u.name, un.name AS unit_name FROM occurrences o JOIN users u ON u.id = o.user_id JOIN units un ON un.id = o.unit_id
       WHERE o.status = 'PENDENTE' AND ${oWhere}`, oArgs),
    q(`SELECT c.id, c.protocol, c.created_at AS at, u.name FROM contestations c JOIN users u ON u.id = c.user_id WHERE c.status = 'ABERTA' AND ${cWhere}`, cArgs),
    q(`SELECT la.id, la.at, la.distance_m, w.name, j.unit_id, j.starts_at, un.name AS unit_name FROM location_alerts la
       JOIN work_sessions ws ON ws.id = la.work_session_id JOIN applications a ON a.id = ws.application_id JOIN users w ON w.id = a.user_id
       JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id WHERE la.acknowledged_at IS NULL AND ${uWhere}`, uArgs),
  ]);
  const activity = (x) => `/gestao/atividades?unit=${x.unit_id}&date=${day(x.starts_at)}`;
  const items = [
    ...alerts.map((x) => ({ key: `loc:${x.id}`, kind: 'SAIDA_DO_RAIO', at: x.at, title: `Saída do raio: ${x.name}`, detail: `${x.unit_name} · ${Math.round(x.distance_m)} m da loja`, link: activity(x) })),
    ...exceptions.map((x) => ({ key: `exc:${x.id}`, kind: 'EXCECAO', at: x.at, title: `Exceção: ${x.name}`, detail: `${x.unit_name} · ${x.type} · ${x.reason}`, link: activity(x) })),
    ...closures.map((x) => ({ key: `close:${x.id}`, kind: 'CHECKOUT_PENDENTE', at: x.at, title: `Checkout pendente: ${x.name}`, detail: x.unit_name, link: activity(x) })),
    ...applications.map((x) => ({ key: `app:${x.id}:${x.n}`, kind: 'CANDIDATURA', at: x.at, title: `${x.n} candidatura(s): ${x.title}`, detail: `${x.unit_name} · ${day(x.starts_at)}`, link: `/gestao/vagas/${x.id}` })),
    ...documents.map((x) => ({ key: `doc:${x.id}:${x.n}`, kind: 'DOCUMENTO', at: x.at, title: `${x.n} documento(s): ${x.name}`, detail: 'Aguardando análise', link: `/gestao/profissionais/${x.id}` })),
    ...occurrences.map((x) => ({ key: `occ:${x.id}`, kind: 'OCORRENCIA', at: x.at, title: `Ocorrência a confirmar: ${x.name}`, detail: `${x.unit_name} · ${x.type}`, link: '/gestao/ocorrencias' })),
    ...contestations.map((x) => ({ key: `ct:${x.id}`, kind: 'CONTESTACAO', at: x.at, title: `Contestação ${x.protocol}: ${x.name}`, detail: 'Análise prioritária', link: '/gestao/ocorrencias' })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  res.json({ serverNow: new Date(), items });
});

export default r;
