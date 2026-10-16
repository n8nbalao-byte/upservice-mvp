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
export async function evolution(path, { method = 'GET', body, cfg } = {}) {
  cfg ??= await whatsappConfig();
  if (!cfg) fail(503, 'WhatsApp ainda não configurado. Veja Configurações.');
  let resp;
  try {
    resp = await fetch(`${cfg.url.replace(/\/+$/, '')}${path.replace('{instance}', encodeURIComponent(cfg.instance))}`, {
      method,
      headers: { apikey: cfg.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
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

/** Envia texto para um celular brasileiro (DDD + número). */
export async function sendWhatsapp(phone, text) {
  const digits = String(phone).replace(/\D/g, '');
  await evolution('/message/sendText/{instance}', { method: 'POST', body: { number: digits.startsWith('55') ? digits : `55${digits}`, text } });
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
