// Unidades, usuários, vínculos gestor↔unidade e revisão de documentos.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { canLogin, publicUser, requireRole, workerAllowed } from '../auth.js';
import { q, tx } from '../db.js';
import { geocode, lookupCep } from '../geo.js';
import { applyBlock, ctx, endBlock, flush } from '../penalties.js';
import { BLOCK_DAYS } from '../rules.js';
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

const cepDigits = (v) => {
  const cep = String(v ?? '').replace(/\D/g, '');
  if (cep.length !== 8) fail(400, 'CEP inválido.');
  return cep;
};

// Nº da filial do Atacadão (opcional, único): liga a loja às planilhas de escala.
const filialDigits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (d.length > 6) fail(400, 'Nº da filial inválido.');
  return d || null;
};

async function assertFilialFree(tq, filial, unitId = '') {
  if (!filial) return;
  const [other] = await tq('SELECT code FROM units WHERE filial = ? AND id <> ?', [filial, unitId]);
  if (other) fail(409, `Filial ${filial} já cadastrada em ${other.code}.`);
}

function unitFields(b) {
  const uf = String(b.uf ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) fail(400, 'UF inválida.');
  const f = {
    name: text(b.name, 'nome', { min: 2 }),
    filial: filialDigits(b.filial),
    phone: text(b.phone, 'telefone', { max: 20, optional: true }),
    region: text(b.region, 'região', { max: 100, optional: true }),
    cep: cepDigits(b.cep),
    street: text(b.street, 'logradouro', { min: 3 }),
    number: text(b.number, 'número', { max: 20 }),
    district: text(b.district, 'bairro', { max: 100 }),
    city: text(b.city, 'cidade', { max: 100 }),
    uf,
    lat: num(b.lat, 'latitude', -90, 90),
    lng: num(b.lng, 'longitude', -180, 180),
    radius_m: int(b.radiusM ?? 300, 'raio', 100, 500),
    max_accuracy_m: int(b.maxAccuracyM ?? 100, 'precisão máxima', 10, 500),
  };
  f.address = `${f.street}, ${f.number} - ${f.district}, ${f.city}/${f.uf}, CEP ${f.cep.slice(0, 5)}-${f.cep.slice(5)}`;
  return f;
}

/** Código sequencial ATC-001, ATC-002…; a trava evita dois cadastros simultâneos com o mesmo número. */
export async function createUnit(req, body) {
  const fields = unitFields(body);
  return tx(async (tq) => {
    await assertFilialFree(tq, fields.filial);
    const [last] = await tq("SELECT code FROM units WHERE code LIKE 'ATC-%' ORDER BY CAST(SUBSTRING(code, 5) AS UNSIGNED) DESC LIMIT 1 FOR UPDATE");
    const code = `ATC-${String(Number(last?.code.slice(4) ?? 0) + 1).padStart(3, '0')}`;
    const unit = { id: randomUUID(), code, ...fields };
    await tq('INSERT INTO units SET ?', [unit]);
    await audit(tq, req, 'UNIT_CREATE', 'unit', unit.id, { after: unit });
    return unit;
  });
}

r.post('/units', ADMIN, async (req, res) => {
  const unit = await createUnit(req, req.body);
  res.status(201).json({ id: unit.id, code: unit.code });
});

r.put('/units/:id', ADMIN, async (req, res) => {
  const [before] = await q('SELECT * FROM units WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'Não encontrado.');
  const after = unitFields(req.body); // o código não muda depois de criado
  await assertFilialFree(q, after.filial, before.id);
  await q('UPDATE units SET ? WHERE id = ?', [after, before.id]);
  await audit(q, req, 'UNIT_UPDATE', 'unit', before.id, { before, after });
  res.json({ ok: true });
});

// CEP → endereço; com número → também coordenadas. Só administrador cadastra unidade.
r.get('/geo/address', ADMIN, async (req, res) => {
  const cep = cepDigits(req.query.cep);
  const address = await lookupCep(cep);
  const number = String(req.query.number ?? '').trim().slice(0, 20);
  res.json({ ...address, ...(number ? await geocode({ ...address, number, cep }) : {}) });
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
  const blockType = { BLOQUEADO_TEMPORARIAMENTE: 'BLOQUEIO_TEMPORARIO', BLOQUEADO_PERMANENTEMENTE: 'BLOQUEIO_PERMANENTE' };
  const c = await tx(async (tq) => {
    const c = ctx(tq, req);
    await tq('UPDATE users SET role = ? WHERE id = ?', [after.role, req.params.id]);
    const worker = after.role === 'PROFISSIONAL';
    if (after.status !== before.status) {
      if (worker && blockType[after.status]) {
        // Bloqueio de profissional sempre vira penalidade: prazo, aviso, vagas futuras liberadas e contestação.
        await applyBlock(c, { userId: req.params.id, type: blockType[after.status], reason, days: after.status === 'BLOQUEADO_TEMPORARIAMENTE' ? BLOCK_DAYS : null });
      } else if (worker && blockType[before.status] && after.status === 'ATIVO') {
        for (const p of await tq("SELECT * FROM penalties WHERE user_id = ? AND status = 'ATIVA' FOR UPDATE", [req.params.id])) await endBlock(c, p, 'ENCERRADA', reason);
        await tq("UPDATE users SET status = 'ATIVO' WHERE id = ?", [req.params.id]);
      } else {
        await tq('UPDATE users SET status = ? WHERE id = ?', [after.status, req.params.id]);
      }
    }
    // Quem não pode mais entrar perde as sessões abertas (profissional bloqueado mantém o modo restrito).
    const [now] = await tq('SELECT role, status FROM users WHERE id = ?', [req.params.id]);
    if (!canLogin(now)) await tq('DELETE FROM sessions WHERE user_id = ?', [req.params.id]);
    await audit(tq, req, 'USER_UPDATE', 'user', req.params.id, { before, after, reason });
    return c;
  });
  await flush(c);
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

// Fila de análise: mesmo escopo de workerAllowed (admin vê todos; gestor, quem se candidatou nas suas lojas).
r.get('/manage/documents/pending', MANAGERS, async (req, res) => {
  const isAdmin = req.user.role === 'ADMINISTRADOR';
  res.json(await q(
    `SELECT u.id, u.name, u.email, COUNT(*) AS pending, MIN(d.created_at) AS oldest
     FROM worker_documents d JOIN users u ON u.id = d.user_id
     WHERE d.status = 'PENDENTE' ${isAdmin ? '' : `AND EXISTS (
       SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
       JOIN unit_managers m ON m.unit_id = j.unit_id AND m.active = 1
       WHERE a.user_id = u.id AND m.user_id = ?)`}
     GROUP BY u.id, u.name, u.email ORDER BY oldest LIMIT 200`,
    isAdmin ? [] : [req.user.id],
  ));
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
