// Configurações → WhatsApp (só o administrador principal): API oficial da Meta, situação do número, modelos de
// mensagem (cadastro e aprovação), liga/desliga dos avisos e mensagem de teste.
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireOwner } from '../auth.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { AVISOS, MODELOS, cadastroModelo } from '../whatsappModelos.js';
import { avisosConfig, forgetNumber, graph, modelosNaMeta, phoneInfo, saveWhatsappConfig, sendTemplate, whatsappConfig } from '../whatsapp.js';

const r = Router();
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');
const phoneDigits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (!/^\d{10,11}$/.test(d)) fail(400, 'Informe o celular com DDD.');
  return d;
};

r.get('/admin/whatsapp', requireOwner, async (req, res) => {
  const cfg = await whatsappConfig();
  const avisos = await avisosConfig();
  const out = {
    configured: !!cfg?.token, source: cfg?.source, phoneId: cfg?.phoneId ?? '', wabaId: cfg?.wabaId ?? '', hasToken: !!cfg?.token, hasSecret: !!cfg?.appSecret,
    webhookUrl: `${APP_URL()}/api/whatsapp/webhook`, verifyToken: cfg?.verifyToken ?? null,
    avisos: Object.entries(AVISOS).map(([key, label]) => ({ key, label, on: avisos[key] !== false })),
  };
  if (!out.configured) return res.json(out);
  try {
    const p = await phoneInfo(cfg);
    out.state = p?.status === 'CONNECTED' ? 'CONECTADO' : p?.status === 'PENDING' ? 'PENDENTE' : 'DESCONECTADO';
    Object.assign(out, { number: String(p?.display_phone_number ?? '').replace(/\D/g, '').replace(/^55/, '') || null, name: p?.verified_name ?? null, quality: p?.quality_rating ?? null, tier: p?.messaging_limit_tier ?? null });
  } catch (e) {
    out.state = 'ERRO';
    out.message = e.message;
  }
  const naMeta = await modelosNaMeta({ fresh: true }).catch((e) => { out.message ??= e.message; return {}; });
  out.modelos = Object.entries(MODELOS).map(([nome, m]) => ({ nome, label: m.label ?? AVISOS[m.aviso], status: naMeta[nome]?.status ?? null, motivo: naMeta[nome]?.motivo ?? null }));
  res.json(out);
});

r.put('/admin/whatsapp', requireOwner, async (req, res) => {
  const cfg = await whatsappConfig();
  if (cfg?.source === 'env') fail(409, 'A configuração vem das variáveis do servidor (WHATSAPP_*). Altere no painel da hospedagem.');
  const phoneId = String(req.body.phoneId ?? '').trim();
  const wabaId = String(req.body.wabaId ?? '').trim();
  const token = String(req.body.token ?? '').trim();
  const appSecret = String(req.body.appSecret ?? '').trim();
  if (!/^\d{5,25}$/.test(phoneId)) fail(400, 'Phone Number ID inválido (só números).');
  if (!/^\d{5,25}$/.test(wabaId)) fail(400, 'WhatsApp Business Account ID inválido (só números).');
  if (token.length > 1000 || /\s/.test(token)) fail(400, 'Token inválido.');
  if (appSecret && !/^[a-f0-9]{32}$/i.test(appSecret)) fail(400, 'Chave secreta do app inválida (32 letras e números).');
  if (!token && !cfg?.token) fail(400, 'Informe o token de acesso.');
  if (!appSecret && !cfg?.appSecret) fail(400, 'Informe a chave secreta do app.');
  await saveWhatsappConfig({ phoneId, wabaId, token, appSecret }, req.user.id);
  await audit(q, req, 'SETTING_WHATSAPP', 'app_settings', 'whatsapp', { after: { phoneId, wabaId, tokenChanged: !!token, secretChanged: !!appSecret } });
  res.json({ ok: true });
});

// Cadastra na Meta os modelos que ainda não existem; a aprovação leva de minutos a 24 h.
r.post('/admin/whatsapp/modelos', requireOwner, async (req, res) => {
  const naMeta = await modelosNaMeta({ fresh: true });
  const erros = [];
  let criados = 0;
  for (const nome of Object.keys(MODELOS).filter((n) => !naMeta[n])) {
    try {
      await graph('/{waba}/message_templates', { method: 'POST', body: cadastroModelo(nome) });
      criados += 1;
    } catch (e) {
      erros.push(`${nome}: ${e.message}`);
    }
  }
  forgetNumber();
  await audit(q, req, 'WHATSAPP_MODELOS', 'app_settings', 'whatsapp', { after: { criados, erros: erros.length } });
  res.json({ criados, erros });
});

r.put('/admin/whatsapp/avisos', requireOwner, async (req, res) => {
  const before = await avisosConfig();
  const after = Object.fromEntries(Object.keys(AVISOS).map((k) => [k, k in (req.body ?? {}) ? req.body[k] === true : before[k] !== false]));
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('whatsapp_avisos', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [JSON.stringify(after), req.user.id]);
  await audit(q, req, 'WHATSAPP_AVISOS', 'app_settings', 'whatsapp_avisos', { before, after });
  res.json({ ok: true });
});

r.post('/admin/whatsapp/test', requireOwner, async (req, res) => {
  const number = phoneDigits(req.body.phone);
  if (!(await sendTemplate(number, 'codigo_acesso', { vars: ['123456'] }))) fail(409, 'O modelo do código de acesso ainda não foi aprovado pela Meta.');
  await audit(q, req, 'WHATSAPP_TEST', 'app_settings', 'whatsapp');
  res.json({ ok: true });
});

export default r;
