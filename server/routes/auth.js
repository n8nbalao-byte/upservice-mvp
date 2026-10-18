import { Router } from 'express';
import { audit } from '../audit.js';
import { devLoginEnabled, endSession, findOrCreateUser, requireOwner, startSession } from '../auth.js';
import { q } from '../db.js';
import { gamificationOn } from './estrelas.js';
import { phoneLoginEnabled } from './login.js';
import { fail, text } from '../http.js';

const r = Router();

r.get('/config', async (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    devLogin: devLoginEnabled(),
    // WhatsApp oficial da UP Service (o mesmo do site); SUPPORT_WHATSAPP no painel troca o número.
    supportWhatsapp: (process.env.SUPPORT_WHATSAPP || '5511926746277').replace(/\D/g, '') || null,
    // Com o WhatsApp da UP Service no ar: entrar por código e confirmar o número (obrigatório para todos).
    phoneLogin: await phoneLoginEnabled(),
    // Estrelas do profissional (prévia): só aparece para ele quando o principal liga em Configurações.
    gamification: await gamificationOn(),
  });
});

// Números públicos da operação (site institucional): só totais, nenhum dado pessoal. Cache de 10 min.
const STATS_MS = 10 * 60e3;
let stats = null;
r.get('/public/stats', async (req, res) => {
  if (!stats || Date.now() - stats.at > STATS_MS) {
    const [row] = await q(
      `SELECT (SELECT COUNT(*) FROM units WHERE status = 'ATIVA') AS lojas,
              (SELECT COUNT(*) FROM users WHERE role = 'PROFISSIONAL' AND deleted_at IS NULL AND status <> 'INATIVO') AS profissionais,
              (SELECT COUNT(*) FROM daily_confirmations WHERE result = 'CONCLUIDA') AS diarias,
              (SELECT COUNT(*) FROM jobs WHERE status = 'ABERTA' AND starts_at > ?) AS vagasAbertas`,
      [new Date()],
    );
    stats = { at: Date.now(), body: { ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])), desde: 2016, atualizadoEm: new Date().toISOString() } };
  }
  res.set('Cache-Control', 'public, max-age=600');
  res.json(stats.body);
});

r.put('/admin/settings/gamification', requireOwner, async (req, res) => {
  const on = req.body.enabled === true;
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('gamification', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [on ? 'on' : 'off', req.user.id]);
  await audit(q, req, 'SETTING_GAMIFICATION', 'app_settings', 'gamification', { after: { enabled: on } });
  res.json({ enabled: on });
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
