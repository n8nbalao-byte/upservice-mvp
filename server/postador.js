// Postador de vagas: cada loja tem o seu grupo de WhatsApp; as vagas abertas da loja vão para o grupo dela num resumo
// (uma mensagem por grupo, com todas as vagas novas), alguns minutos depois de cadastradas — assim a importação da
// escala vira uma mensagem por loja, e não dezenas. A loja guarda o id do grupo, que não muda se o número da UP mudar
// (basta o número novo estar no grupo).
import { q } from './db.js';
import { fail } from './http.js';
import { connectedNumber, sendToGroup, whatsappConfig } from './whatsapp.js';

const TZ = 'America/Sao_Paulo';
const QUIET_MS = 3 * 60e3; // espera 3 min sem vaga nova na loja antes de postar o resumo
const POR_VARREDURA = 5; // grupos por minuto, para não disparar dezenas de mensagens de uma vez
const MAX_LINHAS = 40;
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDia = (d) => {
  const s = new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '').replace(',', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtHora = (d) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export async function postadorConfig() {
  const [row] = await q("SELECT value FROM app_settings WHERE name = 'postador'");
  return row ? JSON.parse(row.value) : { enabled: false };
}

// ---------- sugestão do grupo de cada loja, pelo nome ----------

const ALIAS = [[/\bsto\b/g, 'santo'], [/\bsta\b/g, 'santa'], [/\bsbc\b/g, 'sao bernardo'], [/\bgru\b/g, 'guarulhos'], [/\bitaqua\b/g, 'itaquaquecetuba'], [/\bvl\b/g, 'vila'], [/\bjd\b/g, 'jardim']];
/** "UP- STO ANDRÉ ESTADO" e "Atacadão Santo André Estado" viram a mesma chave: "santoandreestado". */
export function chaveNome(s) {
  let t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/^\s*up\s*[-–:]?\s*/, '').replace(/\batacadao\b/g, ' ');
  for (const [re, to] of ALIAS) t = t.replace(re, to);
  return t.replace(/[^a-z0-9]/g, '');
}

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Para cada loja, o grupo cujo nome mais combina (igual, termina com ele, ou difere em 1–2 letras); sem combinar, nada. */
export function sugerirGrupos(units, groups) {
  const gs = groups.map((g) => ({ id: g.id, k: chaveNome(g.subject) })).filter((g) => g.k.length >= 4);
  const out = {};
  for (const u of units) {
    const k = chaveNome(u.name);
    let best = null;
    for (const g of gs) {
      const score = g.k === k ? 3 : k.endsWith(g.k) && g.k.length >= 5 ? 2 : distancia(g.k, k) <= (k.length > 10 ? 2 : 1) ? 1 : 0;
      if (score && (!best || score > best.score)) best = { id: g.id, score };
    }
    if (best) out[u.id] = best.id;
  }
  return out;
}

// ---------- mensagem e envio ----------

/** Resumo das vagas da loja, agrupadas por dia: horário, função, valor e quantas posições estão livres. */
export function mensagemVagas(unit, jobs, numero) {
  const linhas = [`📢 *Vagas abertas · ${unit.name}*`];
  if (unit.address) linhas.push(unit.address);
  let dia = null;
  for (const j of jobs.slice(0, MAX_LINHAS)) {
    const d = fmtDia(j.starts_at);
    if (d !== dia) { linhas.push('', `*${d}*`); dia = d; }
    const livres = j.positions - Number(j.approved ?? 0);
    linhas.push(`• ${fmtHora(j.starts_at)}–${fmtHora(j.ends_at)} · ${j.title} · ${brl(j.daily_value)} · ${livres} vaga${livres > 1 ? 's' : ''}`);
  }
  if (jobs.length > MAX_LINHAS) linhas.push('', `…e mais ${jobs.length - MAX_LINHAS} vagas no app.`);
  linhas.push('', `👉 Candidate-se pelo app: ${APP_URL()}/vagas`);
  if (numero) linhas.push(`💬 Ou pelo WhatsApp da UP Service: https://wa.me/55${numero} (mande "oi")`);
  return linhas.join('\n');
}

/** Posta no grupo da loja as vagas abertas (só as pendentes de postagem, ou todas no "Postar agora"). Devolve quantas. */
export async function postarLoja(unitId, { now = new Date(), todas = false } = {}) {
  const [un] = await q("SELECT id, code, name, address, whatsapp_group FROM units WHERE id = ? AND status = 'ATIVA'", [unitId]);
  if (!un) fail(404, 'Loja não encontrada.');
  if (!un.whatsapp_group) fail(409, 'Escolha o grupo do WhatsApp desta loja antes.');
  const jobs = (await q(
    `SELECT j.id, j.title, j.starts_at, j.ends_at, j.daily_value, j.positions,
            (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'APROVADA') AS approved
     FROM jobs j ${todas ? '' : "JOIN vagas_postagens p ON p.job_id = j.id AND p.status = 'PENDENTE'"}
     WHERE j.unit_id = ? AND j.status = 'ABERTA' AND j.starts_at > ? ORDER BY j.starts_at`,
    [unitId, now],
  )).filter((j) => j.positions - Number(j.approved) > 0);
  try {
    if (jobs.length) await sendToGroup(un.whatsapp_group, mensagemVagas(un, jobs, await connectedNumber()));
  } catch (e) {
    // Grupo inválido ou o número não está nele: não tenta de novo a cada minuto; o "Postar agora" reenvia.
    await q("UPDATE vagas_postagens SET status = 'ERRO' WHERE unit_id = ? AND status = 'PENDENTE'", [unitId]);
    throw e;
  }
  if (jobs.length) {
    await q(
      `INSERT INTO vagas_postagens (job_id, unit_id, status, posted_at) VALUES ?
       ON DUPLICATE KEY UPDATE status = 'POSTADA', posted_at = VALUES(posted_at)`,
      [jobs.map((j) => [j.id, unitId, 'POSTADA', now])],
    );
  }
  // O que estava pendente e não entrou (vaga cheia, cancelada, já começou) não é mais postado.
  await q("UPDATE vagas_postagens SET status = 'IGNORADA' WHERE unit_id = ? AND status = 'PENDENTE'", [unitId]);
  return jobs.length;
}

/** Varredura: registra as vagas abertas novas e posta o resumo das lojas que pararam de receber vagas há 3 min. */
export async function postarVagas(now = new Date()) {
  if (!(await postadorConfig()).enabled || !(await whatsappConfig())) return;
  await q(
    `INSERT IGNORE INTO vagas_postagens (job_id, unit_id, detected_at)
     SELECT j.id, j.unit_id, ? FROM jobs j
     WHERE j.status = 'ABERTA' AND j.starts_at > ? AND NOT EXISTS (SELECT 1 FROM vagas_postagens p WHERE p.job_id = j.id)`,
    [now, now],
  );
  const prontas = await q(
    `SELECT p.unit_id FROM vagas_postagens p JOIN units un ON un.id = p.unit_id
     WHERE p.status = 'PENDENTE' AND un.whatsapp_group IS NOT NULL AND un.status = 'ATIVA'
     GROUP BY p.unit_id HAVING MAX(p.detected_at) <= ? ORDER BY MIN(p.detected_at) LIMIT ${POR_VARREDURA}`,
    [new Date(now.getTime() - QUIET_MS)],
  );
  for (const { unit_id } of prontas) await postarLoja(unit_id, { now }).catch((e) => console.error('postador', e.message));
}

/** Ao ligar pela primeira vez: as vagas que já estavam abertas não são despejadas nos grupos (o "Postar agora" posta). */
export async function ignorarAbertas(now = new Date()) {
  await q(
    `INSERT IGNORE INTO vagas_postagens (job_id, unit_id, status, detected_at)
     SELECT j.id, j.unit_id, 'IGNORADA', ? FROM jobs j WHERE j.status = 'ABERTA' AND j.starts_at > ?`,
    [now, now],
  );
}
