// Configurações → WhatsApp (só o administrador principal): Evolution API, status, conexão por QR Code ou código.
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireOwner } from '../auth.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { connectedNumber, evolution, forgetNumber, saveWhatsappConfig, sendWhatsapp, whatsappConfig } from '../whatsapp.js';

const r = Router();
const STATES = { open: 'CONECTADO', connecting: 'CONECTANDO', close: 'DESCONECTADO' };
const phoneDigits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (!/^\d{10,11}$/.test(d)) fail(400, 'Informe o celular com DDD.');
  return `55${d}`;
};

r.get('/admin/whatsapp', requireOwner, async (req, res) => {
  const cfg = await whatsappConfig();
  if (!cfg) return res.json({ configured: false });
  const out = { configured: true, source: cfg.source, url: cfg.url, instance: cfg.instance, hasKey: !!cfg.key };
  try {
    const s = await evolution('/instance/connectionState/{instance}', { cfg });
    out.state = STATES[s?.instance?.state] ?? 'DESCONHECIDO';
    if (out.state === 'CONECTADO') out.number = await connectedNumber();
  } catch (e) {
    out.state = e.status === 404 ? 'SEM_INSTANCIA' : 'ERRO';
    out.message = e.message;
  }
  res.json(out);
});

r.put('/admin/whatsapp', requireOwner, async (req, res) => {
  if ((await whatsappConfig())?.source === 'env') fail(409, 'A configuração vem das variáveis do servidor (EVOLUTION_*). Altere no painel da hospedagem.');
  const url = String(req.body.url ?? '').trim();
  const instance = String(req.body.instance ?? '').trim() || 'upservice';
  const key = String(req.body.key ?? '').trim();
  if (!/^https?:\/\/[^\s/]+/i.test(url) || url.length > 200) fail(400, 'Endereço da Evolution API inválido (comece com https://).');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(instance)) fail(400, 'Nome da instância: só letras, números, - e _.');
  if (key.length > 200) fail(400, 'Chave grande demais.');
  if (!key && !(await whatsappConfig())?.key) fail(400, 'Informe a chave (apikey) da Evolution API.');
  await saveWhatsappConfig({ url, key, instance }, req.user.id);
  await audit(q, req, 'SETTING_WHATSAPP', 'app_settings', 'evolution', { after: { url, instance, keyChanged: !!key } });
  res.json({ ok: true });
});

r.post('/admin/whatsapp/create', requireOwner, async (req, res) => {
  const cfg = await whatsappConfig();
  const data = await evolution('/instance/create', { method: 'POST', cfg, body: { instanceName: cfg?.instance, integration: 'WHATSAPP-BAILEYS', qrcode: true } });
  // A Evolution devolve a chave própria da instância: guardar ela no lugar da chave geral limita o que o app pode fazer.
  const token = typeof data?.hash === 'string' ? data.hash : data?.hash?.apikey;
  if (token && cfg.source === 'db') await saveWhatsappConfig({ url: cfg.url, instance: cfg.instance, key: token }, req.user.id);
  await audit(q, req, 'WHATSAPP_INSTANCE_CREATE', 'app_settings', 'evolution', { after: { instance: cfg.instance, ownKey: !!token } });
  res.json({ ok: true });
});

r.post('/admin/whatsapp/connect', requireOwner, async (req, res) => {
  forgetNumber();
  const number = req.body.method === 'code' ? phoneDigits(req.body.phone) : null;
  const data = await evolution(`/instance/connect/{instance}${number ? `?number=${number}` : ''}`);
  const qr = typeof data?.base64 === 'string' && data.base64.startsWith('data:image/png;base64,') ? data.base64 : null;
  const pairingCode = typeof data?.pairingCode === 'string' ? data.pairingCode.replace(/[^A-Z0-9-]/gi, '').slice(0, 16) : null;
  if (!qr && !pairingCode) {
    const s = await evolution('/instance/connectionState/{instance}');
    if (s?.instance?.state === 'open') return res.json({ state: 'CONECTADO' });
    fail(502, 'A Evolution API não devolveu QR Code nem código. Tente de novo em alguns segundos.');
  }
  await audit(q, req, 'WHATSAPP_CONNECT', 'app_settings', 'evolution', { after: { method: number ? 'code' : 'qr' } });
  res.json({ qr: number ? null : qr, pairingCode: number ? pairingCode : null });
});

r.post('/admin/whatsapp/logout', requireOwner, async (req, res) => {
  await evolution('/instance/logout/{instance}', { method: 'DELETE' });
  forgetNumber();
  await audit(q, req, 'WHATSAPP_LOGOUT', 'app_settings', 'evolution');
  res.json({ ok: true });
});

r.post('/admin/whatsapp/test', requireOwner, async (req, res) => {
  const number = phoneDigits(req.body.phone);
  await sendWhatsapp(number, 'Teste do app UP Service: o WhatsApp está conectado. ✅');
  await audit(q, req, 'WHATSAPP_TEST', 'app_settings', 'evolution');
  res.json({ ok: true });
});

export default r;
