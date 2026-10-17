// Atendimento pelo WhatsApp: a Evolution chama o webhook a cada mensagem recebida; o administrador principal liga e
// desliga em Configurações → WhatsApp (isso cadastra ou desativa o webhook na Evolution).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireOwner } from '../auth.js';
import { handleWebhook } from '../bot.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { evolution } from '../whatsapp.js';

const r = Router();
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');

async function botConfig() {
  const [row] = await q("SELECT value FROM app_settings WHERE name = 'whatsapp_bot'");
  return row ? JSON.parse(row.value) : { enabled: false, secret: null };
}
const sameSecret = (a, b) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Responde na hora (a Evolution não espera) e atende em segundo plano.
r.post('/whatsapp/webhook', async (req, res) => {
  const cfg = await botConfig();
  if (!sameSecret(String(req.query.token ?? ''), cfg.secret ?? '')) fail(401, 'Não autorizado.');
  res.json({ ok: true });
  if (cfg.enabled) setImmediate(() => handleWebhook(req.body).catch((e) => console.error('whatsapp-bot', e.message)));
});

r.get('/admin/whatsapp/bot', requireOwner, async (req, res) => {
  res.json({ enabled: !!(await botConfig()).enabled });
});

r.put('/admin/whatsapp/bot', requireOwner, async (req, res) => {
  const enabled = req.body.enabled === true;
  const cfg = await botConfig();
  const secret = cfg.secret ?? randomBytes(24).toString('hex');
  // Cadastra (ou desliga) o webhook na Evolution: mensagens recebidas e votos de enquete.
  await evolution('/webhook/set/{instance}', {
    method: 'POST',
    body: { webhook: { enabled, url: `${APP_URL()}/api/whatsapp/webhook?token=${secret}`, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } },
  });
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('whatsapp_bot', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [JSON.stringify({ enabled, secret }), req.user.id]);
  await audit(q, req, 'WHATSAPP_BOT', 'app_settings', 'whatsapp_bot', { before: { enabled: !!cfg.enabled }, after: { enabled } });
  res.json({ enabled });
});

export default r;
