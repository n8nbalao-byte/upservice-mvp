import { Router } from 'express';
import { audit } from '../audit.js';
import { devLoginEnabled, endSession, findOrCreateUser, requireOwner, startSession } from '../auth.js';
import { q } from '../db.js';
import { fail, text } from '../http.js';

const r = Router();

/** Perfis de cores do app: 1 = atual (prata e grafite), 2 = inspirado no Atacadão. Escolha global, só do principal. */
export const THEMES = ['padrao', 'atacadao'];
const currentTheme = async () => (await q("SELECT value FROM app_settings WHERE name = 'theme'"))[0]?.value ?? 'padrao';

r.get('/config', async (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    devLogin: devLoginEnabled(),
    supportWhatsapp: (process.env.SUPPORT_WHATSAPP ?? '').replace(/\D/g, '') || null,
    theme: await currentTheme(),
  });
});

r.put('/admin/settings/theme', requireOwner, async (req, res) => {
  const theme = String(req.body.theme ?? '');
  if (!THEMES.includes(theme)) fail(400, 'Perfil de cores inválido.');
  const before = await currentTheme();
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('theme', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [theme, req.user.id]);
  await audit(q, req, 'SETTING_THEME', 'app_settings', 'theme', { before: { theme: before }, after: { theme } });
  res.json({ theme });
});

r.post('/auth/google', async (req, res) => {
  const credential = text(req.body.credential, 'credential', { max: 4096 });
  if (!process.env.GOOGLE_CLIENT_ID) fail(503, 'Login Google não configurado.');
  // ponytail: valida pelo endpoint tokeninfo do Google (1 chamada por login); trocar por verificação JWKS local se o volume de logins crescer muito.
  const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const t = await resp.json().catch(() => ({}));
  const okIssuer = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  if (!resp.ok || t.aud !== process.env.GOOGLE_CLIENT_ID || !okIssuer || t.email_verified !== 'true') fail(401, 'Não foi possível validar o login Google.');
  const user = await findOrCreateUser(t.sub, t.email, t.name);
  await startSession(req, res, user);
  res.json({ ok: true });
});

r.post('/auth/dev', async (req, res) => {
  if (!devLoginEnabled()) fail(404, 'Não encontrado.');
  const email = text(req.body.email, 'email', { max: 254 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'E-mail inválido.');
  const user = await findOrCreateUser(`dev:${email.toLowerCase()}`, email, text(req.body.name, 'nome', { optional: true }));
  await startSession(req, res, user);
  res.json({ ok: true });
});

r.post('/auth/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

export default r;
