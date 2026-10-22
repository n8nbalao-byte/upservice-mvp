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
import { sendWhatsapp, whatsappOnline } from '../whatsapp.js';

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
  // Um comando só: LAST_INSERT_ID(expr) devolve o contador que ESTE pedido gravou. Com um SELECT depois, pedidos
  // simultâneos liam o contador já somado por todos e eram todos recusados.
  const r = await q(
    `INSERT INTO rate_limits (k, window_start, n) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE n = LAST_INSERT_ID(IF(window_start < ?, 1, n + 1)), window_start = IF(window_start < ?, VALUES(window_start), window_start)`,
    [key, now, since, since],
  );
  return (r.insertId || 1) <= max; // linha nova: insertId 0 (a tabela não tem auto-incremento) = 1ª tentativa
}
const limited = async (key, max, windowMs) => { if (!(await hit(key, max, windowMs))) fail(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'); };
// Devolve uma tentativa reservada com hit() (o pedido deu certo, então não conta como erro).
const giveBack = (rawKey) => q('UPDATE rate_limits SET n = GREATEST(n - 1, 0) WHERE k = ?', [sha(rawKey)]);
// Trabalho que depende de a conta existir roda depois da resposta: o tempo de resposta não revela se ela existe.
const later = (label, fn) => setImmediate(() => fn().catch((e) => console.error(label, e.message)));
const clearLimits = (...rawKeys) => q('DELETE FROM rate_limits WHERE k IN (?)', [rawKeys.map(sha)]);
// Mesma rede: /24 no IPv4, /64 no IPv6.
const netOf = (ip) => (String(ip).includes(':') ? String(ip).split(':').slice(0, 4).join(':') : String(ip).split('.').slice(0, 3).join('.'));

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
  // Por conta, qualquer IP (trocar de IP não renova os chutes), mas contam só os ERROS: acertar não gasta, e criar
  // uma senha nova em "Esqueci minha senha" zera. Assim um atacante não consegue deixar o dono sem saída.
  // A tentativa é reservada antes (contagem atômica no banco: pedidos simultâneos não furam o limite) e devolvida se der certo.
  const errs = [[`pw:erro:${email}`, 10, 15 * 60e3], [`pw:erro:dia:${email}`, 30, 24 * 3600e3]];
  const reserved = [];
  for (const [k, max, w] of errs) {
    reserved.push(k);
    if (!(await hit(k, max, w))) {
      for (const rk of reserved) await giveBack(rk); // recusado: não conta como erro
      fail(429, 'Muitas tentativas erradas nesta conta. Entre pelo Google, QR Code ou WhatsApp, ou crie uma senha nova em "Esqueci minha senha".');
    }
  }
  const [u] = await q('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
  const ok = await verifyPassword(password, u?.password_hash);
  if (!u || !ok) fail(401, 'E-mail ou senha incorretos.');
  for (const [k] of errs) await giveBack(k);
  await startSession(req, res, u);
  res.json({ ok: true });
});

// "Esqueci minha senha" (também serve para criar a primeira senha de quem entra com Google).
const FORGOT_OK = { ok: true, message: 'Se este e-mail estiver cadastrado, você vai receber um link para criar uma nova senha em instantes. Confira também o spam.' };

r.post('/auth/password/forgot', async (req, res) => {
  const email = emailOf(req.body.email);
  if (!(await hit(`forgot:ip:${req.ip}`, 10, 3600e3)) || !(await hit(`forgot:email:${email}`, 3, 3600e3))) return res.json(FORGOT_OK);
  res.json(FORGOT_OK);
  later('esqueci a senha', async () => {
    const [u] = await q('SELECT id, name, email, role, status FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
    if (!u || !canLogin(u)) return;
    const token = randomBytes(32).toString('base64url');
    await tx(async (tq) => {
      await tq("UPDATE auth_tokens SET used_at = ? WHERE kind = 'RESET' AND user_id = ? AND used_at IS NULL", [new Date(), u.id]);
      await tq('INSERT INTO auth_tokens SET ?', [{ id: randomUUID(), kind: 'RESET', user_id: u.id, token_hash: sha(token), expires_at: new Date(Date.now() + RESET_MS), created_ip: req.ip }]);
      await audit(tq, { ...req, user: u }, 'PASSWORD_RESET_REQUEST', 'user', u.id);
    });
    await sendMailSafe(u.email, 'UP Service: criar uma nova senha',
      `Olá, ${u.name}.\n\nPara criar uma nova senha, abra o link abaixo (vale por 30 minutos e só uma vez):\n${APP_URL()}/redefinir-senha?t=${token}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`);
  });
});

r.post('/auth/password/reset', async (req, res) => {
  const token = String(req.body.token ?? '');
  const password = passwordRule(req.body.password);
  await limited(`reset:ip:${req.ip}`, 20, 15 * 60e3);
  const hashPw = await hashPassword(password);
  const email = await tx(async (tq) => {
    const [t] = await tq("SELECT * FROM auth_tokens WHERE kind = 'RESET' AND token_hash = ? FOR UPDATE", [sha(token)]);
    if (!t || t.used_at || new Date(t.expires_at) < new Date()) fail(400, 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".');
    await tq('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [new Date(), t.id]);
    await tq('UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL', [hashPw, t.user_id]);
    await tq('DELETE FROM sessions WHERE user_id = ?', [t.user_id]); // troca de senha encerra todas as sessões
    await audit(tq, { ...req, user: { id: t.user_id } }, 'PASSWORD_RESET', 'user', t.user_id);
    return (await tq('SELECT email FROM users WHERE id = ?', [t.user_id]))[0]?.email;
  });
  if (email) await clearLimits(`pw:erro:${email}`, `pw:erro:dia:${email}`); // senha nova: o dono volta a entrar
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
// Contra golpe (um site falso mostra um QR verdadeiro gerado pelo golpista): o celular vê o IP de quem pediu e,
// se não for a mesma rede do celular, só autoriza confirmando de forma explícita que está na frente do computador.
const sameNetwork = (a, b) => netOf(a) === netOf(b);
r.get('/auth/qr/:id', requireLogin, async (req, res) => {
  const t = await qrRow(req.params.id);
  if (!t) fail(404, 'Pedido de acesso não encontrado.');
  res.json({ status: qrState(t), createdAt: t.created_at, expiresAt: t.expires_at, device: t.user_agent, ip: t.created_ip, sameNetwork: sameNetwork(t.created_ip, req.ip) });
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
    if (!sameNetwork(t.created_ip, req.ip) && req.body.otherNetwork !== true) {
      fail(428, 'Este pedido veio de outra rede. Confirme que você está na frente do computador para autorizar.');
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

// ---------- WhatsApp: confirmar o número da conta e entrar por código ----------
// O login por código só vale para o número que a própria pessoa confirmou (users.whatsapp, único entre contas):
// o telefone digitado no cadastro não basta, senão um número errado daria acesso a quem fosse o dono dele.

// Só com o número conectado de verdade: desconectado ou banido, o app não oferece login nem confirmação por WhatsApp.
export const phoneLoginEnabled = () => whatsappOnline();
const phoneOf = (v) => {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (!/^\d{10,11}$/.test(d)) fail(400, 'Informe o celular com DDD.');
  return d;
};
const newCode = () => String(randomInt(0, 1000000)).padStart(6, '0');
const PHONE_OK = { ok: true, message: 'Se este número estiver confirmado em uma conta, você vai receber um código no WhatsApp em instantes.' };
const VERIFY_OK = { ok: true, message: 'Se o número puder ser usado, o código chega no WhatsApp em instantes. Não chegou? Se o número já estiver em outra conta, fale com a UP Service.' };
const requireWhatsapp = async () => { if (!(await phoneLoginEnabled())) fail(503, 'O WhatsApp da UP Service está indisponível no momento. Entre com e-mail e senha ou com o Google.'); };

// Confirmação (logado): envia um código para o número informado; ele só vira o WhatsApp da conta depois do código.
r.post('/me/whatsapp/start', requireLogin, async (req, res) => {
  await requireWhatsapp();
  const phone = phoneOf(req.body.phone);
  await limited(`verify:user:${req.user.id}`, 5, 3600e3);
  // Teto por número, qualquer conta: ninguém usa a confirmação para encher o WhatsApp de outra pessoa.
  const allowed = await hit(`verify:hora:${phone}`, 3, 3600e3);
  res.json(VERIFY_OK);
  if (!allowed) return;
  // Depois da resposta (o tempo não revela se o número já está em outra conta, caso em que nada é enviado).
  const userId = req.user.id;
  later('confirmar WhatsApp', async () => {
    const [other] = await q('SELECT id FROM users WHERE whatsapp = ? AND id <> ?', [phone, userId]);
    if (other) return;
    const code = newCode();
    await q("UPDATE auth_tokens SET used_at = ? WHERE kind = 'VERIFY' AND user_id = ? AND used_at IS NULL", [new Date(), userId]);
    await q('INSERT INTO auth_tokens SET ?', [{ id: randomUUID(), kind: 'VERIFY', user_id: userId, token_hash: sha(`verify:${randomUUID()}`), secret_hash: sha(`${phone}:${code}`), target: phone, expires_at: new Date(Date.now() + OTP_MS), created_ip: req.ip }]);
    await sendWhatsapp(phone, `Código para confirmar seu WhatsApp no app UP Service: ${code}\nVale por 5 minutos. Se não foi você, ignore.`);
  });
});

r.post('/me/whatsapp/verify', requireLogin, async (req, res) => {
  const code = String(req.body.code ?? '').trim();
  await limited(`verifycheck:user:${req.user.id}`, 10, 15 * 60e3);
  const phone = await tx(async (tq) => {
    const [t] = await tq("SELECT * FROM auth_tokens WHERE kind = 'VERIFY' AND user_id = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [req.user.id]);
    if (!t || new Date(t.expires_at) < new Date()) return null;
    if (sha(`${t.target}:${code}`) !== t.secret_hash) {
      await tq('UPDATE auth_tokens SET used_at = IF(attempts + 1 >= 5, ?, used_at), attempts = attempts + 1 WHERE id = ?', [new Date(), t.id]);
      return null;
    }
    await tq('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [new Date(), t.id]);
    try {
      await tq('UPDATE users SET whatsapp = ?, whatsapp_verified_at = ? WHERE id = ?', [t.target, new Date(), req.user.id]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') fail(400, 'Não foi possível confirmar este número. Fale com a UP Service.');
      throw e;
    }
    await audit(tq, req, 'WHATSAPP_VERIFY', 'user', req.user.id);
    return t.target;
  });
  if (!phone) fail(400, 'Código inválido ou expirado.');
  res.json({ ok: true, whatsapp: phone });
});

// Login por código: só para número confirmado; resposta igual exista ou não a conta.
// O código fica preso ao aparelho que pediu (cookie httpOnly): de outro aparelho ninguém consegue conferir, nem chutar,
// nem invalidar o código de quem pediu. Pedir de novo em outro aparelho não derruba o código pendente.
const OTP_COOKIE = 'otp_device';
const otpDeviceOf = (req) => /(?:^|;\s*)otp_device=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
const otpCookie = (value, maxAge) => `${OTP_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/phone; Max-Age=${maxAge}`;

r.post('/auth/phone/start', async (req, res) => {
  await requireWhatsapp();
  const phone = phoneOf(req.body.phone);
  const device = randomBytes(24).toString('base64url');
  res.setHeader('Set-Cookie', otpCookie(device, OTP_MS / 1000));
  // Envios: por IP, por número a partir da mesma rede e tetos por número para qualquer rede (contra encher o
  // WhatsApp de alguém). Quem passar do teto atrasa o código por WhatsApp daquele número; os outros métodos seguem.
  const allowed = (await hit(`otp:ip:${req.ip}`, 10, 3600e3)) && (await hit(`otp:rede:${phone}:${netOf(req.ip)}`, 3, 15 * 60e3))
    && (await hit(`otp:hora:${phone}`, 6, 3600e3)) && (await hit(`otp:dia:${phone}`, 15, 24 * 3600e3));
  res.json(PHONE_OK);
  if (!allowed) return;
  // Depois da resposta: o tempo de resposta não revela se o número tem conta.
  const ip = req.ip;
  later('código de login por WhatsApp', async () => {
    const [u] = await q('SELECT * FROM users WHERE whatsapp = ? AND whatsapp_verified_at IS NOT NULL AND deleted_at IS NULL', [phone]);
    if (!u || !canLogin(u)) return;
    const code = newCode();
    await q('INSERT INTO auth_tokens SET ?', [{ id: randomUUID(), kind: 'OTP', user_id: u.id, token_hash: sha(`otpdev:${device}`), secret_hash: sha(`${phone}:${code}`), target: phone, expires_at: new Date(Date.now() + OTP_MS), created_ip: ip }]);
    await sendWhatsapp(phone, `Seu código de acesso UP Service: ${code}\nVale por 5 minutos. Não compartilhe com ninguém.`);
  });
});

r.post('/auth/phone/verify', async (req, res) => {
  await requireWhatsapp();
  const phone = phoneOf(req.body.phone);
  const code = String(req.body.code ?? '').trim();
  await limited(`otpverify:ip:${req.ip}`, 30, 15 * 60e3);
  const device = otpDeviceOf(req);
  if (!device) fail(401, 'Código inválido ou expirado.');
  const user = await tx(async (tq) => {
    const [t] = await tq("SELECT * FROM auth_tokens WHERE kind = 'OTP' AND token_hash = ? AND target = ? AND used_at IS NULL FOR UPDATE", [sha(`otpdev:${device}`), phone]);
    if (!t || new Date(t.expires_at) < new Date()) return null;
    if (sha(`${phone}:${code}`) !== t.secret_hash) {
      // 5 erros invalidam o código.
      await tq('UPDATE auth_tokens SET used_at = IF(attempts + 1 >= 5, ?, used_at), attempts = attempts + 1 WHERE id = ?', [new Date(), t.id]);
      return null;
    }
    await tq('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [new Date(), t.id]);
    return (await tq('SELECT * FROM users WHERE id = ? AND whatsapp = ? AND deleted_at IS NULL', [t.user_id, phone]))[0] ?? null;
  });
  if (!user) fail(401, 'Código inválido ou expirado.');
  await startSession(req, res, user);
  res.append('Set-Cookie', otpCookie('', 0));
  res.json({ ok: true });
});

export default r;
