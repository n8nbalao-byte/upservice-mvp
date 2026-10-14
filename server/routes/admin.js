// Unidades, usuários, vínculos gestor↔unidade e revisão de documentos.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { publicUser, requireRole, workerAllowed } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, int, num, requireReason, text } from '../http.js';
import { profileState } from './worker.js';

const r = Router();
const ADMIN = requireRole('ADMINISTRADOR');
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
const ROLES = ['PROFISSIONAL', 'GESTOR', 'ADMINISTRADOR'];
const USER_STATUS = ['ATIVO', 'EM_ANALISE', 'BLOQUEADO_TEMPORARIAMENTE', 'BLOQUEADO_PERMANENTEMENTE', 'INATIVO'];
const UNIT_STATUS = ['ATIVA', 'BLOQUEADA_FINANCEIRA', 'INATIVA'];

// ---------- Unidades ----------

r.get('/units', MANAGERS, async (req, res) => {
  res.json(req.user.role === 'ADMINISTRADOR'
    ? await q('SELECT * FROM units ORDER BY code')
    : await q('SELECT u.* FROM units u JOIN unit_managers m ON m.unit_id = u.id AND m.active = 1 WHERE m.user_id = ? ORDER BY u.code', [req.user.id]));
});

function unitFields(b) {
  const code = String(b.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) fail(400, 'Código da unidade: 2 a 20 letras, números ou hífen.');
  return {
    code,
    name: text(b.name, 'nome', { min: 2 }),
    region: text(b.region, 'região', { max: 100, optional: true }),
    address: text(b.address, 'endereço', { min: 5, max: 300 }),
    lat: num(b.lat, 'latitude', -90, 90),
    lng: num(b.lng, 'longitude', -180, 180),
    radius_m: int(b.radiusM ?? 300, 'raio', 100, 500),
    max_accuracy_m: int(b.maxAccuracyM ?? 100, 'precisão máxima', 10, 500),
  };
}

const dup = (e, msg) => {
  if (e.code === 'ER_DUP_ENTRY') fail(409, msg);
  throw e;
};

r.post('/units', ADMIN, async (req, res) => {
  const unit = { id: randomUUID(), ...unitFields(req.body) };
  await q('INSERT INTO units SET ?', [unit]).catch((e) => dup(e, 'Já existe unidade com este código.'));
  await audit(q, req, 'UNIT_CREATE', 'unit', unit.id, { after: unit });
  res.status(201).json({ id: unit.id });
});

r.put('/units/:id', ADMIN, async (req, res) => {
  const [before] = await q('SELECT * FROM units WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'Não encontrado.');
  const after = unitFields(req.body);
  await q('UPDATE units SET ? WHERE id = ?', [after, before.id]).catch((e) => dup(e, 'Já existe unidade com este código.'));
  await audit(q, req, 'UNIT_UPDATE', 'unit', before.id, { before, after });
  res.json({ ok: true });
});

// Bloqueio não cancela atividades já aprovadas nem apaga histórico; só impede novas vagas e candidaturas.
r.post('/units/:id/status', ADMIN, async (req, res) => {
  const status = req.body.status;
  if (!UNIT_STATUS.includes(status)) fail(400, 'Status inválido.');
  const reason = requireReason(req.body.reason);
  const [before] = await q('SELECT status FROM units WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'Não encontrado.');
  await q('UPDATE units SET status = ?, status_reason = ? WHERE id = ?', [status, reason, req.params.id]);
  await audit(q, req, 'UNIT_STATUS', 'unit', req.params.id, { before, after: { status }, reason });
  res.json({ ok: true });
});

// ---------- Usuários ----------

r.get('/admin/users', ADMIN, async (req, res) => {
  const term = `%${String(req.query.q ?? '').trim()}%`;
  const users = await q('SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY role DESC, name LIMIT 100', [term, term]);
  const links = users.length ? await q('SELECT user_id, unit_id FROM unit_managers WHERE active = 1 AND user_id IN (?)', [users.map((u) => u.id)]) : [];
  res.json(users.map((u) => ({ ...publicUser(u), unitIds: links.filter((l) => l.user_id === u.id).map((l) => l.unit_id) })));
});

r.patch('/admin/users/:id', ADMIN, async (req, res) => {
  if (req.params.id === req.user.id) fail(403, 'Ninguém pode alterar o próprio papel ou status.');
  const reason = requireReason(req.body.reason);
  const [before] = await q('SELECT role, status FROM users WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'Não encontrado.');
  const after = { role: req.body.role ?? before.role, status: req.body.status ?? before.status };
  if (!ROLES.includes(after.role) || !USER_STATUS.includes(after.status)) fail(400, 'Papel ou status inválido.');
  await tx(async (tq) => {
    await tq('UPDATE users SET role = ?, status = ? WHERE id = ?', [after.role, after.status, req.params.id]);
    if (after.status !== 'ATIVO' && after.status !== 'EM_ANALISE') await tq('DELETE FROM sessions WHERE user_id = ?', [req.params.id]);
    await audit(tq, req, 'USER_UPDATE', 'user', req.params.id, { before, after, reason });
  });
  res.json({ ok: true });
});

r.put('/admin/users/:id/units', ADMIN, async (req, res) => {
  const unitIds = Array.isArray(req.body.unitIds) ? req.body.unitIds.map(String) : fail(400, 'Lista de unidades inválida.');
  const [user] = await q('SELECT role FROM users WHERE id = ?', [req.params.id]);
  if (user?.role !== 'GESTOR') fail(400, 'Vínculos de unidade são só para gestores.');
  await tx(async (tq) => {
    // Remover vínculo desativa (histórico preservado); nunca apaga.
    await tq('UPDATE unit_managers SET active = 0 WHERE user_id = ?', [req.params.id]);
    for (const unitId of unitIds) {
      await tq('INSERT INTO unit_managers (user_id, unit_id) VALUES (?,?) ON DUPLICATE KEY UPDATE active = 1', [req.params.id, unitId]);
    }
    await audit(tq, req, 'MANAGER_UNITS', 'user', req.params.id, { after: { unitIds } });
  });
  res.json({ ok: true });
});

// ---------- Profissionais e documentos ----------

r.get('/manage/workers/:id', MANAGERS, async (req, res) => {
  if (!(await workerAllowed(req.user, req.params.id))) fail(404, 'Não encontrado.');
  const [user] = await q("SELECT * FROM users WHERE id = ? AND role = 'PROFISSIONAL'", [req.params.id]);
  if (!user) fail(404, 'Não encontrado.');
  await audit(q, req, 'WORKER_VIEW', 'user', user.id);
  res.json({ user: publicUser(user), ...(await profileState(user.id)) });
});

r.post('/manage/documents/:id/review', MANAGERS, async (req, res) => {
  const status = req.body.status;
  if (status !== 'APROVADO' && status !== 'REJEITADO') fail(400, 'Status inválido.');
  const reason = status === 'REJEITADO' ? text(req.body.reason, 'motivo da rejeição', { min: 5, max: 500 }) : null;
  const [doc] = await q('SELECT id, user_id, status FROM worker_documents WHERE id = ?', [req.params.id]);
  if (!doc || !(await workerAllowed(req.user, doc.user_id))) fail(404, 'Não encontrado.');
  if (doc.status !== 'PENDENTE') fail(409, 'Documento já analisado.');
  await q('UPDATE worker_documents SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', [status, reason, req.user.id, new Date(), doc.id]);
  await audit(q, req, 'DOCUMENT_REVIEW', 'worker_document', doc.id, { before: { status: doc.status }, after: { status }, reason });
  res.json({ ok: true });
});

export default r;
