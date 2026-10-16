// Login por e-mail e senha, recuperação de senha, QR Code (celular autoriza o computador) e código por WhatsApp.
// Regras gerais: tokens aleatórios guardados só como hash e de uso único; respostas iguais exista ou não a conta;
// limite de tentativas por IP e por identificador; a conta nova continua sendo criada só pelo Google.
import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { audit } from '../audit.js';
import { canLogin, requireLogin, startSession } from '../auth.js';
import { q, tx } from '../db.js';
import { fail } from '../http.js';
import { sendMailSafe } from '../mail.js';

const r = Router();
const scryptAsync = promisify(scrypt);
const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
const RESET_MS = 30 * 60e3;
const QR_MS = 2 * 60e3;
const OTP_MS = 5 * 60e3;
const APP_URL = () => process.env.APP_URL || 'https://app.upserviceintermed.com';

// ---------- Limite de tentativas (tabela: vale para vários processos do app) ----------

// A chave vira hash: cabe na coluna e não guarda e-mail, telefone ou IP em texto.
async function hit(rawKey, max, windowMs) {
  const key = sha(rawKey);
  const now = new Date();
  const since = new Date(now.getTime() - windowMs);
  await q(
    `INSERT INTO rate_limits (k, window_start, n) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE n = IF(window_start < ?, 1, n + 1), window_start = IF(window_start < ?, VALUES(window_start), window_start)`,
    [key, now, since, since],
  );
  const [row] = await q('SELECT n FROM rate_limits WHERE k = ?', [key]);
  return row.n <= max;
}
const limited = async (key, max, windowMs) => { if (!(await hit(key, max, windowMs))) fail(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'); };

// ---------- Senha (scrypt com sal por usuário; nunca em texto) ----------

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [, salt, key] = String(stored ?? '').split('$');
  if (!salt || !key) {
    await scryptAsync(pw, 'tempo-constante', 32); // mesma demora quando não há senha: não revela se a conta existe
    return false;
  }
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), 32);
  return timingSafeEqual(got, Buffer.from(key, 'base64'));
}
function passwordRule(pw) {
  const p = String(pw ?? '');
  if (p.length < 8 || p.length > 128 || !/[a-zA-Z]/.test(p) || !/\d/.test(p)) fail(400, 'A senha precisa ter de 8 a 128 caracteres, com letras e números.');
  return p;
}
const emailOf = (v) => String(v ?? '').trim().toLowerCase().slice(0, 254);

r.post('/auth/password', async (req, res) => {
  const email = emailOf(req.body.email);
  const password = String(req.body.password ?? '');
  await limited(`pw:ip:${req.ip}`, 20, 15 * 60e3);
  await limited(`pw:email:${email}`, 10, 15 * 60e3);
  const [u] = await q('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
  const ok = await verifyPassword(password, u?.password_hash);
  if (!u || !ok) fail(401, 'E-mail ou senha incorretos.');
  await startSession(req, res, u);
  res.json({ ok: true });
});

// "Esqueci minha senha" (também serve para criar a primeira senha de quem entra com Google).
const FORGOT_OK = { ok: true, message: 'Se este e-mail estiver cadastrado, você vai receber um link para criar uma nova senha em instantes. Confira também o spam.' };

r.post('/auth/password/forgot', async (req, res) => {
  const email = emailOf(req.body.email);
  if (!(await hit(`forgot:ip:${req.ip}`, 10, 3600e3)) || !(await hit(`forgot:email:${email}`, 3, 3600e3))) return res.json(FORGOT_OK);
  const [u] = await q('SELECT id, name, email, role, status FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
  if (u && canLogin(u)) {
    const token = randomBytes(32).toString('base64url');
    await tx(async (tq) => {
      await tq("UPDATE auth_tokens SET used_at = ? WHERE kind = 'RESET' AND user_id = ? AND used_at IS NULL", [new Date(), u.id]);
      await tq('INSERT INTO auth_tokens SET ?', [{ id: randomUUID(), kind: 'RESET', user_id: u.id, token_hash: sha(token), expires_at: new Date(Date.now() + RESET_MS), created_ip: req.ip }]);
      await audit(tq, { ...req, user: u }, 'PASSWORD_RESET_REQUEST', 'user', u.id);
    });
    // Sem await: a resposta leva o mesmo tempo exista ou não a conta (sendMailSafe nunca lança).
    sendMailSafe(u.email, 'UP Service: criar uma nova senha',
      `Olá, ${u.name}.\n\nPara criar uma nova senha, abra o link abaixo (vale por 30 minutos e só uma vez):\n${APP_URL()}/redefinir-senha?t=${token}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`);
  }
  res.json(FORGOT_OK);
});

r.post('/auth/password/reset', async (req, res) => {
  const token = String(req.body.token ?? '');
  const password = passwordRule(req.body.password);
  await limited(`reset:ip:${req.ip}`, 20, 15 * 60e3);
  const hashPw = await hashPassword(password);
  await tx(async (tq) => {
    const [t] = await tq("SELECT * FROM auth_tokens WHERE kind = 'RESET' AND token_hash = ? FOR UPDATE", [sha(token)]);
    if (!t || t.used_at || new Date(t.expires_at) < new Date()) fail(400, 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".');
    await tq('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [new Date(), t.id]);
    await tq('UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL', [hashPw, t.user_id]);
    await tq('DELETE FROM sessions WHERE user_id = ?', [t.user_id]); // troca de senha encerra todas as sessões
    await audit(tq, { ...req, user: { id: t.user_id } }, 'PASSWORD_RESET', 'user', t.user_id);
  });
  res.json({ ok: true });
});

// ---------- QR Code: o computador mostra; o celular, já identificado, confere o número e autoriza ----------
// O QR leva só o id público. O computador guarda um segredo num cookie httpOnly e só ele recebe a sessão,
// uma única vez. Escanear não autoriza nada: é preciso estar logado no celular e digitar o número mostrado.

const QR_COOKIE = 'qr_secret';
const qrSecretOf = (req) => /(?:^|;\s*)qr_secret=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
const qrCookie = (value, maxAge) => `${QR_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/qr; Max-Age=${maxAge}`;

r.post('/auth/qr/start', async (req, res) => {
  await limited(`qr:ip:${req.ip}`, 20, 10 * 60e3);
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const code = String(randomInt(10, 100));
  const expiresAt = new Date(Date.now() + QR_MS);
  await q('INSERT INTO auth_tokens SET ?', [{
    id, kind: 'QR', token_hash: sha(`qr:${id}`), secret_hash: sha(secret), code, expires_at: expiresAt,
    created_ip: req.ip, user_agent: String(req.get('user-agent') ?? '').slice(0, 200),
  }]);
  res.setHeader('Set-Cookie', qrCookie(secret, QR_MS / 1000));
  res.json({ id, code, expiresAt });
});

const qrRow = async (id) => (await q("SELECT * FROM auth_tokens WHERE id = ? AND kind = 'QR'", [String(id)]))[0];
const qrState = (t) => (t.used_at ? 'ENCERRADO' : new Date(t.expires_at) < new Date() ? 'EXPIRADO' : t.approved_at ? 'CONFIRMADO' : 'AGUARDANDO');

// Celular (logado): dados do pedido para conferir antes de autorizar. Não devolve o número.
r.get('/auth/qr/:id', requireLogin, async (req, res) => {
  const t = await qrRow(req.params.id);
  if (!t) fail(404, 'Pedido de acesso não encontrado.');
  res.json({ status: qrState(t), createdAt: t.created_at, expiresAt: t.expires_at, device: t.user_agent });
});

r.post('/auth/qr/:id/approve', requireLogin, async (req, res) => {
  await limited(`qrapprove:user:${req.user.id}`, 10, 10 * 60e3);
  const code = String(req.body.code ?? '').trim();
  const wrongCode = await tx(async (tq) => {
    const [t] = await tq("SELECT * FROM auth_tokens WHERE id = ? AND kind = 'QR' FOR UPDATE", [String(req.params.id)]);
    if (!t) fail(404, 'Pedido de acesso não encontrado.');
    if (qrState(t) !== 'AGUARDANDO') fail(409, 'Este QR Code expirou ou já foi usado. Gere outro no computador.');
    if (req.body.deny) {
      await tq('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [new Date(), t.id]);
      return false;
    }
    if (code !== t.code) {
      // 3 erros invalidam o QR: evita adivinhar o número de um QR alheio. Retorna em vez de lançar, senão o rollback apaga a contagem.
      await tq('UPDATE auth_tokens SET used_at = IF(attempts + 1 >= 3, ?, used_at), attempts = attempts + 1 WHERE id = ?', [new Date(), t.id]);
      return true;
    }
    await tq('UPDATE auth_tokens SET user_id = ?, approved_at = ? WHERE id = ?', [req.user.id, new Date(), t.id]);
    await audit(tq, req, 'QR_LOGIN_APPROVE', 'user', req.user.id, { after: { qr: t.id } });
    return false;
  });
  if (wrongCode) fail(400, 'O número não confere com o que aparece no computador.');
  res.json({ ok: true });
});

// Computador: consulta com o segredo do cookie; recebe a sessão uma única vez.
r.get('/auth/qr/:id/status', async (req, res) => {
  const secret = qrSecretOf(req);
  const t = await qrRow(req.params.id);
  if (!t || !secret || sha(secret) !== t.secret_hash) fail(404, 'Pedido de acesso não encontrado.');
  const status = qrState(t);
  if (status !== 'CONFIRMADO') return res.json({ status });
  const user = await tx(async (tq) => {
    const done = await tq("UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND approved_at IS NOT NULL AND expires_at > ?", [new Date(), t.id, new Date()]);
    if (!done.affectedRows) return null;
    return (await tq('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [t.user_id]))[0] ?? null;
  });
  if (!user) return res.json({ status: 'ENCERRADO' });
  await startSession(req, res, user);
  res.append('Set-Cookie', qrCookie('', 0));
  res.json({ status: 'CONFIRMADO' });
});

// ---------- Código por WhatsApp (Evolution API do cliente). Só aparece com as variáveis configuradas ----------

export const phoneLoginEnabled = () => !!(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE);
const phoneOf = (v) => {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (!/^\d{10,11}$/.test(d)) fail(400, 'Informe o celular com DDD.');
  return d;
};
const PHONE_OK = { ok: true, message: 'Se este número estiver cadastrado, você vai receber um código no WhatsApp em instantes.' };

async function sendWhatsapp(phone, message) {
  const url = `${process.env.EVOLUTION_API_URL.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(process.env.EVOLUTION_INSTANCE)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY },
    body: JSON.stringify({ number: `55${phone}`, text: message }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Evolution API respondeu ${resp.status}`);
}

r.post('/auth/phone/start', async (req, res) => {
  if (!phoneLoginEnabled()) fail(503, 'Entrar pelo telefone ainda não está disponível.');
  const phone = phoneOf(req.body.phone);
  if (!(await hit(`otp:ip:${req.ip}`, 10, 3600e3)) || !(await hit(`otp:phone:${phone}`, 3, 15 * 60e3))) return res.json(PHONE_OK);
  // Só envia se o telefone for de exatamente uma conta ativa (telefone repetido entre contas não identifica ninguém).
  const users = await q('SELECT u.* FROM users u JOIN worker_profiles p ON p.user_id = u.id WHERE p.phone = ? AND u.deleted_at IS NULL', [phone]);
  if (users.length === 1 && canLogin(users[0])) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await q("UPDATE auth_tokens SET used_at = ? WHERE kind = 'OTP' AND target = ? AND used_at IS NULL", [new Date(), phone]);
    await q('INSERT INTO auth_tokens SET ?', [{ id: randomUUID(), kind: 'OTP', user_id: users[0].id, token_hash: sha(`otp:${randomUUID()}`), secret_hash: sha(`${phone}:${code}`), target: phone, expires_at: new Date(Date.now() + OTP_MS), created_ip: req.ip }]);
    // Sem await: a resposta leva o mesmo tempo exista ou não a conta; falha de envio só vai para o log.
    sendWhatsapp(phone, `Seu código de acesso UP Service: ${code}\nVale por 5 minutos. Não compartilhe com ninguém.`)
      .catch((e) => console.error('falha ao enviar código por WhatsApp', e.message));
  }
  res.json(PHONE_OK);
});

r.post('/auth/phone/verify', async (req, res) => {
  if (!phoneLoginEnabled()) fail(503, 'Entrar pelo telefone ainda não está disponível.');
  const phone = phoneOf(req.body.phone);
  const code = String(req.body.code ?? '').trim();
  await limited(`otpverify:ip:${req.ip}`, 30, 15 * 60e3);
  const user = await tx(async (tq) => {
    const [t] = await tq("SELECT * FROM auth_tokens WHERE kind = 'OTP' AND target = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [phone]);
    if (!t || new Date(t.expires_at) < new Date()) return null;
    if (sha(`${phone}:${code}`) !== t.secret_hash) {
      // 5 erros invalidam o código.
      await tq('UPDATE auth_tokens SET used_at = IF(attempts + 1 >= 5, ?, used_at), attempts = attempts + 1 WHERE id = ?', [new Date(), t.id]);
      return null;
    }
    await tq('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [new Date(), t.id]);
    return (await tq('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [t.user_id]))[0] ?? null;
  });
  if (!user) fail(401, 'Código inválido ou expirado.');
  await startSession(req, res, user);
  res.json({ ok: true });
});

export default r;
