// Unidades, usuários, vínculos gestor↔unidade e revisão de documentos.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { canLogin, publicUser, requireOwner, requireRole, workerAllowed } from '../auth.js';
import { q, tx } from '../db.js';
import { geocode, lookupCep } from '../geo.js';
import { applyBlock, ctx, endBlock, flush } from '../penalties.js';
import { BLOCK_DAYS } from '../rules.js';
import { fail, int, num, requireReason, text } from '../http.js';
import { promoteFromWaitlist } from '../staffing.js';
import { removeFile } from '../storage.js';
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
  const users = await q('SELECT * FROM users WHERE deleted_at IS NULL AND (name LIKE ? OR email LIKE ?) ORDER BY role DESC, name LIMIT 100', [term, term]);
  const links = users.length ? await q('SELECT user_id, unit_id FROM unit_managers WHERE active = 1 AND user_id IN (?)', [users.map((u) => u.id)]) : [];
  res.json(users.map((u) => ({ ...publicUser(u), unitIds: links.filter((l) => l.user_id === u.id).map((l) => l.unit_id) })));
});

r.patch('/admin/users/:id', ADMIN, async (req, res) => {
  if (req.params.id === req.user.id) fail(403, 'Ninguém pode alterar o próprio papel ou status.');
  const reason = requireReason(req.body.reason);
  const [target] = await q('SELECT role, status, is_owner, deleted_at FROM users WHERE id = ?', [req.params.id]);
  if (!target || target.deleted_at) fail(404, 'Não encontrado.');
  const before = { role: target.role, status: target.status };
  const after = { role: req.body.role ?? before.role, status: req.body.status ?? before.status };
  if (!ROLES.includes(after.role) || !USER_STATUS.includes(after.status)) fail(400, 'Papel ou status inválido.');
  // O administrador principal não é alterado por aqui (evita que outro admin o bloqueie ou rebaixe).
  if (target.is_owner) fail(403, 'O administrador principal não pode ser alterado.');
  // Dar ou tirar o papel de administrador, ou mexer em outro administrador (status, bloqueio), é só do principal:
  // um admin comum não consegue tirar o acesso de um colega.
  if (!req.user.is_owner && (after.role === 'ADMINISTRADOR' || before.role === 'ADMINISTRADOR')) {
    fail(403, 'Somente o administrador principal pode alterar administradores ou conceder esse papel.');
  }
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

/**
 * Exclusão de usuário (só o administrador principal): o acesso acaba na hora e os dados pessoais saem.
 * Sem histórico (nunca se candidatou nem teve ocorrência/bloqueio/contestação): apagado por completo.
 * Com histórico: diárias e presença ficam (retenção de 5 anos dos termos), mas anonimizadas: sem nome, e-mail,
 * Google, perfil (CPF etc.), documentos nem selfies. Vagas futuras e reserva são liberadas para a fila.
 */
r.delete('/admin/users/:id', requireOwner, async (req, res) => {
  if (req.params.id === req.user.id) fail(403, 'Você não pode excluir a própria conta.');
  const reason = requireReason(req.body?.reason);
  const files = [];
  const { c, mode, released } = await tx(async (tq) => {
    const c = ctx(tq, req);
    const [u] = await tq('SELECT id, role, is_owner, deleted_at FROM users WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!u || u.deleted_at) fail(404, 'Não encontrado.');
    if (u.is_owner) fail(403, 'O administrador principal não pode ser excluído.');

    const future = await tq(
      `SELECT a.id, a.job_id, ws.id AS session_id FROM applications a JOIN jobs j ON j.id = a.job_id LEFT JOIN work_sessions ws ON ws.application_id = a.id
       WHERE a.user_id = ? AND a.status IN ('APROVADA', 'PENDENTE') AND j.starts_at > ? AND (ws.id IS NULL OR ws.status = 'AGUARDANDO_CHECKIN') FOR UPDATE`,
      [u.id, new Date()],
    );
    for (const f of future) {
      await tq("UPDATE applications SET status = 'CANCELADA', cancel_reason = 'Conta excluída' WHERE id = ?", [f.id]);
      if (f.session_id) await tq("UPDATE work_sessions SET status = 'CANCELADA_ADMINISTRATIVAMENTE' WHERE id = ?", [f.session_id]);
    }
    await tq('DELETE FROM sessions WHERE user_id = ?', [u.id]);
    await tq('DELETE FROM auth_tokens WHERE user_id = ?', [u.id]);
    files.push(...(await tq('SELECT storage_key FROM worker_documents WHERE user_id = ?', [u.id])).map((d) => d.storage_key));

    const [h] = await tq(
      `SELECT (SELECT COUNT(*) FROM applications WHERE user_id = ?) + (SELECT COUNT(*) FROM occurrences WHERE user_id = ?)
            + (SELECT COUNT(*) FROM penalties WHERE user_id = ?) + (SELECT COUNT(*) FROM contestations WHERE user_id = ?) AS n`,
      [u.id, u.id, u.id, u.id],
    );
    await tq('DELETE FROM worker_documents WHERE user_id = ?', [u.id]);
    await tq('DELETE FROM worker_profiles WHERE user_id = ?', [u.id]);
    let mode;
    if (!Number(h.n)) {
      await tq('DELETE FROM unit_managers WHERE user_id = ?', [u.id]);
      await tq('DELETE FROM users WHERE id = ?', [u.id]);
      mode = 'APAGADO';
    } else {
      const selfies = `FROM work_sessions ws JOIN applications a ON a.id = ws.application_id WHERE a.user_id = ?`;
      files.push(...(await tq(`SELECT e.selfie_key AS k FROM presence_events e WHERE e.selfie_key IS NOT NULL AND e.work_session_id IN (SELECT ws.id ${selfies})`, [u.id])).map((r) => r.k));
      files.push(...(await tq(`SELECT x.selfie_key AS k FROM presence_exceptions x WHERE x.selfie_key <> '' AND x.work_session_id IN (SELECT ws.id ${selfies})`, [u.id])).map((r) => r.k));
      await tq(`UPDATE presence_events SET selfie_key = NULL, selfie_sha256 = NULL WHERE work_session_id IN (SELECT id FROM (SELECT ws.id ${selfies}) t)`, [u.id]);
      await tq(`UPDATE presence_exceptions SET selfie_key = '', selfie_sha256 = '' WHERE work_session_id IN (SELECT id FROM (SELECT ws.id ${selfies}) t)`, [u.id]);
      await tq('UPDATE unit_managers SET active = 0 WHERE user_id = ?', [u.id]);
      await tq(
        "UPDATE users SET name = 'Usuário excluído', email = ?, google_sub = NULL, password_hash = NULL, whatsapp = NULL, whatsapp_verified_at = NULL, status = 'INATIVO', deleted_at = ? WHERE id = ?",
        [`excluido+${u.id}@upservice.invalid`, new Date(), u.id],
      );
      mode = 'ANONIMIZADO';
    }
    // Auditoria sem dados pessoais: só papel, modo e quantas vagas foram liberadas.
    await audit(tq, req, 'USER_DELETE', 'user', u.id, { before: { role: u.role }, after: { mode, released: future.length }, reason });
    for (const jobId of new Set(future.map((f) => f.job_id))) await promoteFromWaitlist(c, jobId);
    return { c, mode, released: future.length };
  });
  for (const k of files) await removeFile(k);
  await flush(c);
  res.json({ ok: true, mode, released });
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
