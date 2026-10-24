// Lembrete de cadastro: quem ainda não está habilitado para trabalhar e tem algo a fazer (enviar documento, reenviar
// um reprovado, preencher os dados ou aceitar os termos) recebe um aviso no app e um e-mail dizendo exatamente o que
// falta. Quem só espera a análise da UP Service não é cobrado. No máximo 1 lembrete por semana e 4 no total.
import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { sendMailSafe } from './mail.js';
import { cadastros } from './routes/dashboard.js';

const SEMANA_MS = 7 * 86400e3;
const MAX_LEMBRETES = 4;
const POR_VARREDURA = 20; // e-mails por minuto, para não estourar o limite do SMTP
const TZ = 'America/Sao_Paulo';
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');
const NOME = { CPF: 'CPF', RG: 'RG', COMPROVANTE: 'comprovante de residência', SELFIE: 'selfie' };
const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}` : xs[0]);

/** O que o profissional precisa fazer (vazio = nada; ex.: só espera a análise). */
export function oQueFalta(p) {
  const docs = (st) => Object.entries(p.docs).filter(([, s]) => s === st).map(([t]) => NOME[t] ?? t);
  const itens = [];
  if (!p.perfil) itens.push('preencher seus dados pessoais');
  if (docs('FALTA').length) itens.push(`enviar ${lista(docs('FALTA'))}`);
  if (docs('REJEITADO').length) itens.push(`enviar de novo ${lista(docs('REJEITADO'))} (não foi aprovado)`);
  if (!p.termos) itens.push('aceitar os termos de uso');
  return itens;
}

/** Aviso no app + e-mail. Devolve false se não há nada a pedir; senão, se o e-mail saiu. */
export async function lembrar(p) {
  const itens = oQueFalta(p);
  if (!itens.length) return false;
  const titulo = 'Complete seu cadastro para começar a trabalhar';
  const corpo = `Para pegar vagas, falta ${itens.join('; ')}.`;
  await q('INSERT INTO notifications SET ?', [{ id: randomUUID(), user_id: p.id, kind: 'CADASTRO', title: titulo, body: corpo, link: '/cadastro' }]);
  const email = await sendMailSafe(p.email, `UP Service: ${titulo.toLowerCase()}`,
    `Olá, ${String(p.name).trim().split(/\s+/)[0]}.\n\nSeu cadastro no app UP Service ainda não está completo. ${corpo}\n\nÉ rápido: entre no app e toque em "Cadastro e documentos": ${APP_URL()}/cadastro\n\nAssim que tudo for aprovado, você já pode se candidatar às vagas.\n\nEquipe UP Service`);
  return { email };
}

/** Histórico de lembretes por profissional: quantos e o último. */
async function historico() {
  const rows = await q("SELECT user_id, COUNT(*) AS n, MAX(created_at) AS ultimo FROM notifications WHERE kind = 'CADASTRO' GROUP BY user_id");
  return new Map(rows.map((r) => [r.user_id, { n: Number(r.n), ultimo: new Date(r.ultimo).getTime() }]));
}

/** Quem pode receber agora: conta ativa, cadastrada há mais de 1 dia, com algo a fazer, dentro dos limites. */
export async function pendentesDeLembrete(user, { agora = Date.now(), intervalo = SEMANA_MS, maximo = MAX_LEMBRETES, idadeMin = 86400e3 } = {}) {
  const h = await historico();
  return (await cadastros(user)).filter((p) => {
    const ja = h.get(p.id);
    return !p.habilitado && p.status === 'ATIVO' && agora - new Date(p.createdAt).getTime() >= idadeMin && oQueFalta(p).length
      && (!ja || (ja.n < maximo && agora - ja.ultimo > intervalo));
  });
}

/** Varredura: das 9h às 20h, até 20 lembretes por minuto (os que estão há mais tempo sem lembrete primeiro). */
export async function lembretesCadastro(now = new Date()) {
  const hora = Number(now.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  if (hora < 9 || hora >= 20) return 0;
  const alvo = (await pendentesDeLembrete({ role: 'ADMINISTRADOR' }, { agora: now.getTime() }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, POR_VARREDURA);
  let n = 0;
  for (const p of alvo) if (await lembrar(p)) n++;
  return n;
}
