// Atendimento pelo WhatsApp: a Meta chama o webhook a cada mensagem recebida (e a cada mudança de situação das
// enviadas). O endereço e o token de verificação são cadastrados no painel da Meta; o administrador principal liga e
// desliga o atendimento em Configurações → WhatsApp.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireOwner } from '../auth.js';
import { botConfig, handleWebhook } from '../bot.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { whatsappConfig } from '../whatsapp.js';

const r = Router();
const same = (a, b) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Verificação do painel da Meta ao cadastrar o webhook: devolve o desafio se o token for o nosso.
r.get('/whatsapp/webhook', async (req, res) => {
  const cfg = await whatsappConfig();
  if (req.query['hub.mode'] !== 'subscribe' || !same(String(req.query['hub.verify_token'] ?? ''), cfg?.verifyToken ?? '')) fail(403, 'Não autorizado.');
  res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
});

// Toda chamada vem assinada (HMAC-SHA256 do corpo com a chave secreta do app). Responde na hora e atende em segundo plano.
r.post('/whatsapp/webhook', async (req, res) => {
  const cfg = await whatsappConfig();
  const expected = cfg?.appSecret && req.rawBody ? `sha256=${createHmac('sha256', cfg.appSecret).update(req.rawBody).digest('hex')}` : '';
  if (!same(String(req.get('x-hub-signature-256') ?? ''), expected)) fail(401, 'Não autorizado.');
  res.json({ ok: true });
  setImmediate(() => handleWebhook(req.body).catch((e) => console.error('whatsapp-bot', e.message)));
});

r.get('/admin/whatsapp/bot', requireOwner, async (req, res) => {
  res.json({ enabled: !!(await botConfig()).enabled });
});

r.put('/admin/whatsapp/bot', requireOwner, async (req, res) => {
  const enabled = req.body.enabled === true;
  const before = await botConfig();
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('whatsapp_bot', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [JSON.stringify({ enabled }), req.user.id]);
  await audit(q, req, 'WHATSAPP_BOT', 'app_settings', 'whatsapp_bot', { before: { enabled: !!before.enabled }, after: { enabled } });
  res.json({ enabled });
});

export default r;
