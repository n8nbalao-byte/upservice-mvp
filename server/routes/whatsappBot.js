// Atendimento pelo WhatsApp: a Evolution chama o webhook a cada mensagem recebida; o administrador principal liga e
// desliga em Configurações → WhatsApp (isso cadastra ou desativa o webhook na Evolution).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireOwner } from '../auth.js';
import { botConfig, handleWebhook } from '../bot.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { evolution } from '../whatsapp.js';

const r = Router();
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');

const sameSecret = (a, b) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Responde na hora (a Evolution não espera) e atende em segundo plano. O token vem no cabeçalho x-webhook-token; só se a
// Evolution não guardar cabeçalhos (viaHeader false) é que ele vai na URL.
r.post('/whatsapp/webhook', async (req, res) => {
  const cfg = await botConfig();
  const token = req.get('x-webhook-token') ?? (cfg.viaHeader === false ? req.query.token : null);
  if (!sameSecret(String(token ?? ''), cfg.secret ?? '')) fail(401, 'Não autorizado.');
  res.json({ ok: true });
  if (cfg.enabled) setImmediate(() => handleWebhook(req.body).catch((e) => console.error('whatsapp-bot', e.message)));
});

r.get('/admin/whatsapp/bot', requireOwner, async (req, res) => {
  res.json({ enabled: !!(await botConfig()).enabled });
});

r.put('/admin/whatsapp/bot', requireOwner, async (req, res) => {
  const enabled = req.body.enabled === true;
  const cfg = await botConfig();
  // Token novo a cada vez que liga (um token vazado deixa de valer ao religar); desligar mantém o atual.
  const secret = enabled || !cfg.secret ? randomBytes(32).toString('hex') : cfg.secret;
  const url = `${APP_URL()}/api/whatsapp/webhook`;
  // Cadastra (ou desliga) o webhook na Evolution: mensagens recebidas e votos de enquete.
  const setHook = (hookUrl) => evolution('/webhook/set/{instance}', {
    method: 'POST',
    body: { webhook: { enabled, url: hookUrl, headers: { 'x-webhook-token': secret }, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } },
  });
  await setHook(url);
  // Confere se a Evolution guardou o cabeçalho; se não guardou, o token vai na URL para o atendimento não parar.
  let viaHeader = true;
  if (enabled) {
    const saved = await evolution('/webhook/find/{instance}').catch(() => null);
    viaHeader = saved?.headers?.['x-webhook-token'] === secret;
    if (!viaHeader) await setHook(`${url}?token=${secret}`);
  }
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('whatsapp_bot', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [JSON.stringify({ enabled, secret, viaHeader }), req.user.id]);
  await audit(q, req, 'WHATSAPP_BOT', 'app_settings', 'whatsapp_bot', { before: { enabled: !!cfg.enabled }, after: { enabled } });
  res.json({ enabled });
});

export default r;
