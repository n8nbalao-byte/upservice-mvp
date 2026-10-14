import { Router } from 'express';
import { devLoginEnabled, endSession, findOrCreateUser, startSession } from '../auth.js';
import { fail, text } from '../http.js';

const r = Router();

r.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null, devLogin: devLoginEnabled() });
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
