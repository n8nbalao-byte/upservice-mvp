// WhatsApp da UP Service pela API oficial da Meta (WhatsApp Cloud API). A configuração vem das variáveis WHATSAPP_* do
// painel ou, sem elas, do que o administrador principal salvou em Configurações (app_settings 'whatsapp').
// O token e a chave secreta do app nunca saem do servidor: a tela só sabe se eles existem.
// Mensagem que a UP manda primeiro só sai por modelo aprovado (whatsappModelos.js); texto livre, botões e arquivos só
// dentro das 24 h depois que a pessoa escreveu (respostas do atendimento).
import { randomBytes } from 'node:crypto';
import { q } from './db.js';
import { fail } from './http.js';
import { MODELOS, componentesEnvio } from './whatsappModelos.js';

const GRAPH = () => (process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v24.0').replace(/\/+$/, '');

export async function whatsappConfig() {
  const e = process.env;
  if (e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_ID) {
    return { token: e.WHATSAPP_TOKEN, phoneId: e.WHATSAPP_PHONE_ID, wabaId: e.WHATSAPP_WABA_ID ?? '', appSecret: e.WHATSAPP_APP_SECRET ?? '', verifyToken: e.WHATSAPP_VERIFY_TOKEN ?? '', source: 'env' };
  }
  const [row] = await q("SELECT value FROM app_settings WHERE name = 'whatsapp'");
  return row ? { ...JSON.parse(row.value), source: 'db' } : null;
}

/** Salva o que veio da tela; token e chave em branco mantêm os salvos. O token de verificação do webhook nasce aqui. */
export async function saveWhatsappConfig({ phoneId, wabaId, token, appSecret }, userId) {
  const prev = (await whatsappConfig()) ?? {};
  const value = JSON.stringify({ phoneId, wabaId, token: token || prev.token || '', appSecret: appSecret || prev.appSecret || '', verifyToken: prev.verifyToken || randomBytes(24).toString('hex') });
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('whatsapp', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [value, userId]);
  forgetNumber();
}

/** Chamada à Graph API. Erros viram mensagens claras; nunca devolve o token. */
export async function graph(path, { method = 'GET', body, form, cfg, timeout = 15000 } = {}) {
  cfg ??= await whatsappConfig();
  if (!cfg?.token) fail(503, 'WhatsApp ainda não configurado. Veja Configurações.');
  let resp;
  try {
    resp = await fetch(`${GRAPH()}${path.replace('{phone}', encodeURIComponent(cfg.phoneId)).replace('{waba}', encodeURIComponent(cfg.wabaId))}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    fail(502, `Não foi possível falar com a API do WhatsApp (${e.name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão'}).`);
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401 || data?.error?.code === 190) fail(502, 'A Meta recusou o token do WhatsApp (vencido ou sem permissão).');
  if (!resp.ok) fail(502, `A API do WhatsApp respondeu ${resp.status}${data?.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : ''}.`);
  return data;
}

const toNumber = (phone) => { const d = String(phone).replace(/\D/g, ''); return d.startsWith('55') ? d : `55${d}`; };
const send = (phone, message) => graph('/{phone}/messages', { method: 'POST', body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: toNumber(phone), ...message } });

// ponytail: cópias em memória (1 min do estado, 10 min do número e dos modelos): o /config é chamado em toda abertura do app.
let numero = { at: 0, value: null };
let online = { at: 0, value: false };
let modelos = { at: 0, value: {} };
/** Troca de configuração: a próxima leitura busca de novo. */
export const forgetNumber = () => { numero = { at: 0, value: null }; online = { at: 0, value: false }; modelos = { at: 0, value: {} }; };

/** Situação do número na Meta (status, número, qualidade). */
export const phoneInfo = (cfg) => graph('/{phone}?fields=status,display_phone_number,verified_name,quality_rating,messaging_limit_tier', { cfg, timeout: 5000 });

/** O número está no ar agora? Sem configuração, bloqueado ou fora = false: o app não oferece login nem confirmação. */
export async function whatsappOnline() {
  if (!(await whatsappConfig())?.token) return false;
  if (Date.now() - online.at < 60e3) return online.value;
  let value = false;
  try {
    value = (await phoneInfo())?.status === 'CONNECTED';
  } catch { /* sem resposta da Meta: trata como fora do ar */ }
  online = { at: Date.now(), value };
  return value;
}

/** Número oficial (DDD + número, sem o 55), lido da Meta; null se não souber. */
export async function connectedNumber() {
  if (Date.now() - numero.at < 10 * 60e3) return numero.value;
  let value = null;
  try {
    if ((await whatsappConfig())?.token) {
      const d = String((await phoneInfo())?.display_phone_number ?? '').replace(/\D/g, '');
      value = /^55\d{10,11}$/.test(d) ? d.slice(2) : null;
    }
  } catch { /* sem número: as telas só não mostram */ }
  numero = { at: Date.now(), value };
  return value;
}

/** Situação de cada modelo na Meta: { nome: { status, motivo } } (APPROVED, PENDING, REJECTED…). */
export async function modelosNaMeta({ fresh = false } = {}) {
  if (!fresh && Date.now() - modelos.at < 10 * 60e3) return modelos.value;
  const cfg = await whatsappConfig();
  if (!cfg?.token || !cfg.wabaId) return {};
  const data = await graph('/{waba}/message_templates?fields=name,status,language,rejected_reason&limit=200', { cfg });
  const value = Object.fromEntries((data?.data ?? []).filter((t) => t.language === 'pt_BR' && MODELOS[t.name]).map((t) => [t.name, { status: t.status, motivo: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null }]));
  modelos = { at: Date.now(), value };
  return value;
}
export const modeloAprovado = async (nome) => (await modelosNaMeta().catch(() => ({})))[nome]?.status === 'APPROVED';

/** Avisos desligados em Configurações (padrão: todos ligados). */
export async function avisosConfig() {
  const [row] = await q("SELECT value FROM app_settings WHERE name = 'whatsapp_avisos'");
  return row ? JSON.parse(row.value) : {};
}

/** Envia um modelo aprovado. Devolve false (sem enviar) se o modelo não estiver aprovado ou o aviso estiver desligado. */
export async function sendTemplate(phone, nome, opts = {}) {
  const m = MODELOS[nome];
  if (m.aviso && (await avisosConfig())[m.aviso] === false) return false;
  if (!(await modeloAprovado(nome))) {
    console.log(`[WhatsApp não enviado: modelo ${nome} não aprovado na Meta]`);
    return false;
  }
  await send(phone, { type: 'template', template: { name: nome, language: { code: 'pt_BR' }, components: componentesEnvio(nome, opts) } });
  return true;
}

/** Igual a sendTemplate, mas nunca derruba a operação: sem configuração não envia; falha só vai para o log. */
export async function sendTemplateSafe(phone, nome, opts) {
  try {
    if (!(await whatsappConfig())?.token) return false;
    return await sendTemplate(phone, nome, opts);
  } catch (e) {
    console.error('falha ao enviar WhatsApp', nome, e.message);
    return false;
  }
}

/** Aviso pelo WhatsApp confirmado do usuário, por modelo. Nunca derruba a operação. */
export async function avisar(userId, modelo, opts) {
  try {
    const [u] = await q('SELECT whatsapp FROM users WHERE id = ? AND whatsapp IS NOT NULL AND whatsapp_verified_at IS NOT NULL', [userId]);
    return u ? await sendTemplateSafe(u.whatsapp, modelo, opts) : false;
  } catch (e) {
    console.error('falha ao avisar pelo WhatsApp', e.message);
    return false;
  }
}

// ---------- dentro da conversa (24 h depois da última mensagem da pessoa) ----------

/** Texto livre (respostas do atendimento). */
export async function sendWhatsapp(phone, text) {
  await send(phone, { type: 'text', text: { body: String(text).slice(0, 4096), preview_url: false } });
}

const corta = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Pergunta com opções: até 3 curtas viram botões; até 10, lista; mais que isso, texto numerado (a pessoa responde o
 *  número). O id de cada opção é o número dela ("1", "2"…), então a resposta é entendida igual ao número digitado. */
export async function sendOptions(phone, question, options) {
  const body = { text: corta(question, 1024) };
  let message;
  if (options.length <= 3 && options.every((o) => o.length <= 20)) {
    message = { type: 'interactive', interactive: { type: 'button', body, action: { buttons: options.map((o, i) => ({ type: 'reply', reply: { id: String(i + 1), title: o } })) } } };
  } else if (options.length <= 10) {
    const rows = options.map((o, i) => ({ id: String(i + 1), title: corta(o, 24), ...(o.length > 24 ? { description: corta(o, 72) } : {}) }));
    message = { type: 'interactive', interactive: { type: 'list', body, action: { button: 'Ver opções', sections: [{ title: 'Opções', rows }] } } };
  } else {
    message = { type: 'text', text: { body: corta(`${question}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nResponda com o número.`, 4096), preview_url: false } };
  }
  return (await send(phone, message))?.messages?.[0]?.id ?? null;
}

/** Envia um arquivo (foto ou PDF) com legenda; nunca derruba a operação: falha só vai para o log. */
export async function sendWhatsappMediaSafe(phone, { buf, mime, fileName, caption }) {
  try {
    if (!(await whatsappConfig())?.token) return false;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([buf], { type: mime }), fileName);
    const { id } = await graph('/{phone}/media', { method: 'POST', form, timeout: 60000 });
    await send(phone, mime === 'application/pdf' ? { type: 'document', document: { id, filename: fileName, caption } } : { type: 'image', image: { id, caption } });
    return true;
  } catch (e) {
    console.error('falha ao enviar arquivo pelo WhatsApp', e.message);
    return false;
  }
}
