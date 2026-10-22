// WhatsApp da UP Service pela Evolution API (v2). A configuração vem das variáveis EVOLUTION_* do painel
// ou, sem elas, do que o administrador principal salvou em Configurações (app_settings 'evolution').
// A chave nunca sai do servidor: a tela só sabe se ela existe.
import { q } from './db.js';
import { fail } from './http.js';

const DEFAULT_INSTANCE = 'upservice';

export async function whatsappConfig() {
  if (process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY) {
    return { url: process.env.EVOLUTION_API_URL, key: process.env.EVOLUTION_API_KEY, instance: process.env.EVOLUTION_INSTANCE || DEFAULT_INSTANCE, source: 'env' };
  }
  const [row] = await q("SELECT value FROM app_settings WHERE name = 'evolution'");
  const saved = row ? JSON.parse(row.value) : {};
  if (!saved.url || !saved.key) return null;
  return { url: saved.url, key: saved.key, instance: saved.instance || DEFAULT_INSTANCE, source: 'db' };
}

export async function saveWhatsappConfig({ url, key, instance }, userId) {
  const prev = (await whatsappConfig()) ?? {};
  const value = JSON.stringify({ url, instance, key: key || (prev.source === 'db' ? prev.key : '') });
  if (value.length > 500) fail(400, 'Configuração grande demais.');
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('evolution', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [value, userId]);
}

/** Chamada à Evolution. Erros viram mensagens claras; nunca devolve a chave. */
export async function evolution(path, { method = 'GET', body, cfg, timeout = 15000 } = {}) {
  cfg ??= await whatsappConfig();
  if (!cfg) fail(503, 'WhatsApp ainda não configurado. Veja Configurações.');
  let resp;
  try {
    resp = await fetch(`${cfg.url.replace(/\/+$/, '')}${path.replace('{instance}', encodeURIComponent(cfg.instance))}`, {
      method,
      headers: { apikey: cfg.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    fail(502, `Não foi possível falar com a Evolution API (${e.name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão'}).`);
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401 || resp.status === 403) fail(502, 'A Evolution API recusou a chave.');
  if (resp.status === 404) fail(404, 'Instância não encontrada na Evolution API.');
  if (!resp.ok) fail(502, `A Evolution API respondeu ${resp.status}.`);
  return data;
}

const toNumber = (phone) => { const d = String(phone).replace(/\D/g, ''); return d.startsWith('55') ? d : `55${d}`; };

/** Envia texto para um celular brasileiro (DDD + número). `delay` (ms): mostra "digitando…" antes (atendimento). */
export async function sendWhatsapp(phone, text, { delay } = {}) {
  await evolution('/message/sendText/{instance}', { method: 'POST', body: { number: toNumber(phone), text, ...(delay ? { delay } : {}) } });
}

/** Texto para um grupo (id "…@g.us"); o número da UP precisa estar no grupo. */
export async function sendToGroup(groupId, text) {
  if (!/^[\d-]+@g\.us$/.test(String(groupId))) fail(400, 'Grupo do WhatsApp inválido.');
  await evolution('/message/sendText/{instance}', { method: 'POST', body: { number: groupId, text } });
}

/** Grupos em que o número conectado está (a Evolution pode levar uns 20 s para listar). */
export async function listGroups() {
  const list = await evolution('/group/fetchAllGroups/{instance}?getParticipants=false', { timeout: 90000 });
  return (Array.isArray(list) ? list : []).map((g) => ({ id: g.id, subject: g.subject ?? '', size: g.size ?? null, announce: !!g.announce }))
    .filter((g) => /@g\.us$/.test(g.id)).sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
}

// ponytail: cópia de 10 min do número conectado (muda só quando troca o número na Evolution).
let numero = { at: 0, value: null };
/** Troca de número (conectar/desconectar): a próxima leitura busca de novo. */
export const forgetNumber = () => { numero = { at: 0, value: null }; online = { at: 0, value: false }; };

// ponytail: cópia de 1 min do estado da conexão (o /config é chamado em toda abertura do app).
let online = { at: 0, value: false };
/** O número está conectado agora? Desconectado ou banido = false: o app não oferece login nem confirmação por WhatsApp. */
export async function whatsappOnline() {
  if (!(await whatsappConfig())) return false;
  if (Date.now() - online.at < 60e3) return online.value;
  let value = false;
  try {
    value = (await evolution('/instance/connectionState/{instance}', { timeout: 5000 }))?.instance?.state === 'open';
  } catch { /* sem resposta da Evolution: trata como desconectado */ }
  online = { at: Date.now(), value };
  return value;
}
/** Número conectado na instância (DDD + número, sem o 55), lido da Evolution; null se não souber. */
export async function connectedNumber() {
  if (Date.now() - numero.at < 10 * 60e3) return numero.value;
  let value = null;
  try {
    const cfg = await whatsappConfig();
    if (cfg) {
      const data = await evolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(cfg.instance)}`, { cfg });
      const inst = Array.isArray(data) ? data[0] : data;
      const jid = inst?.ownerJid ?? inst?.instance?.owner ?? inst?.owner ?? '';
      const d = String(jid).split('@')[0].replace(/\D/g, '');
      value = /^55\d{10,11}$/.test(d) ? d.slice(2) : null;
    }
  } catch { /* sem número: as telas e mensagens só não mostram */ }
  numero = { at: Date.now(), value };
  return value;
}

/** Pergunta com opções, como enquete de escolha única: o profissional toca numa opção. As opções vão numeradas
 *  ("1. Vagas"), então responder só o número também vale (celular que não mostra enquete). Devolve o id da mensagem. */
export async function sendOptions(phone, question, options) {
  const data = await evolution('/message/sendPoll/{instance}', {
    method: 'POST',
    body: { number: toNumber(phone), name: question.slice(0, 255), selectableCount: 1, values: options.map((o) => o.slice(0, 100)), delay: 700 },
  });
  return data?.key?.id ?? null;
}

/** Envia um arquivo (foto ou PDF) com legenda; nunca derruba a operação: falha só vai para o log. */
export async function sendWhatsappMediaSafe(phone, { buf, mime, fileName, caption }) {
  try {
    if (!(await whatsappConfig())) return false;
    const digits = String(phone).replace(/\D/g, '');
    await evolution('/message/sendMedia/{instance}', {
      method: 'POST',
      body: { number: digits.startsWith('55') ? digits : `55${digits}`, mediatype: mime === 'application/pdf' ? 'document' : 'image', mimetype: mime, caption, media: buf.toString('base64'), fileName },
    });
    return true;
  } catch (e) {
    console.error('falha ao enviar arquivo pelo WhatsApp', e.message);
    return false;
  }
}

/** Aviso que nunca derruba a operação: sem WhatsApp configurado não envia; falha só vai para o log. */
export async function sendWhatsappSafe(phone, text) {
  try {
    if (!(await whatsappConfig())) return false;
    await sendWhatsapp(phone, text);
    return true;
  } catch (e) {
    console.error('falha ao enviar WhatsApp', e.message);
    return false;
  }
}
