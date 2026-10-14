import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { q } from './db.js';
import { fail } from './http.js';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
// Profissional bloqueado entra em modo restrito (ver motivo e contestar, v4.0 §6); gestor/admin bloqueado não entra.
export const isBlocked = (u) => u.status === 'BLOQUEADO_TEMPORARIAMENTE' || u.status === 'BLOQUEADO_PERMANENTEMENTE';
export const canLogin = (u) => u.status === 'ATIVO' || u.status === 'EM_ANALISE' || (u.role === 'PROFISSIONAL' && isBlocked(u));
const hash = (t) => createHash('sha256').update(t).digest('hex');

export const devLoginEnabled = () => process.env.DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production';

/** Busca pelo identificador Google; se não houver, vincula a conta criada antes por e-mail (ex.: make-admin); senão cria PROFISSIONAL. */
export async function findOrCreateUser(sub, rawEmail, name) {
  const email = rawEmail.trim().toLowerCase();
  let [user] = await q('SELECT * FROM users WHERE google_sub = ?', [sub]);
  if (!user) {
    [user] = await q('SELECT * FROM users WHERE email = ? AND google_sub IS NULL', [email]);
    if (user) await q('UPDATE users SET google_sub = ? WHERE id = ?', [sub, user.id]);
  }
  if (!user) {
    const id = randomUUID();
    // Cadastro aberto: o papel é sempre definido aqui, nunca pelo cliente.
    await q("INSERT INTO users (id, google_sub, email, name, role) VALUES (?,?,?,?,'PROFISSIONAL')", [id, sub, email, name || email]);
    [user] = await q('SELECT * FROM users WHERE id = ?', [id]);
    await audit(q, { user }, 'USER_SIGNUP', 'user', id);
  }
  return user;
}

export async function startSession(req, res, user) {
  if (!canLogin(user)) fail(403, 'Conta bloqueada ou inativa. Fale com a UpService.');
  const token = randomBytes(32).toString('base64url');
  await q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', [hash(token), user.id, new Date(Date.now() + SESSION_MS)]);
  await audit(q, { ...req, user }, 'LOGIN', 'user', user.id);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
}

const sid = (req) => /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];

export async function endSession(req, res) {
  const token = sid(req);
  if (token) await q('DELETE FROM sessions WHERE token_hash = ?', [hash(token)]);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}

export async function loadUser(req, res, next) {
  const token = sid(req);
  if (token) {
    const [user] = await q('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', [hash(token), new Date()]);
    // Bloqueio vale na hora, inclusive para sessões já abertas.
    if (user && canLogin(user)) req.user = user;
  }
  next();
}

export const requireLogin = (req, res, next) => {
  if (!req.user) fail(401, 'Faça login para continuar.');
  next();
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) fail(401, 'Faça login para continuar.');
  if (!roles.includes(req.user.role)) fail(403, 'Sem permissão para esta ação.');
  next();
};

export async function unitAllowed(user, unitId) {
  if (user.role === 'ADMINISTRADOR') return true;
  if (user.role !== 'GESTOR') return false;
  const [row] = await q('SELECT 1 FROM unit_managers WHERE user_id = ? AND unit_id = ? AND active = 1', [user.id, unitId]);
  return !!row;
}

/** 404 em vez de 403 para não revelar a existência de recursos de outras unidades. */
export async function assertUnit(user, unitId) {
  if (!(await unitAllowed(user, unitId))) fail(404, 'Não encontrado.');
}

/** Profissional vê o próprio; admin vê todos; gestor vê quem tem candidatura em unidade vinculada a ele. */
export async function workerAllowed(user, workerId) {
  if (user.id === workerId || user.role === 'ADMINISTRADOR') return true;
  if (user.role !== 'GESTOR') return false;
  const [row] = await q(
    `SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
     JOIN unit_managers m ON m.unit_id = j.unit_id AND m.active = 1
     WHERE a.user_id = ? AND m.user_id = ? LIMIT 1`,
    [workerId, user.id],
  );
  return !!row;
}

/** Mesmo escopo de workerAllowed, em SQL: admin vê tudo; gestor, quem se candidatou em loja vinculada a ele. */
export const workerScope = (user, col) => (user.role === 'ADMINISTRADOR'
  ? ['1 = 1', []]
  : [`EXISTS (SELECT 1 FROM applications sa JOIN jobs sj ON sj.id = sa.job_id JOIN unit_managers sm ON sm.unit_id = sj.unit_id AND sm.active = 1
             WHERE sa.user_id = ${col} AND sm.user_id = ?)`, [user.id]]);
export const unitScope = (user, col) => (user.role === 'ADMINISTRADOR'
  ? ['1 = 1', []]
  : [`${col} IN (SELECT unit_id FROM unit_managers WHERE user_id = ? AND active = 1)`, [user.id]]);

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status });
