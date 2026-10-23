// Atendimento do profissional pelo WhatsApp: um bot que conversa por botões e listas (o profissional toca numa opção) e faz
// pelo WhatsApp o que ele faz no app (menos as Estrelas). Só responde a quem tem o WhatsApp confirmado na conta; as
// ações usam as mesmas funções do app (mesmas regras) e pedem Sim/Não antes de mudar algo.
//
// Cada passo (STEPS) monta { text?, question, options: [[rótulo, próximo passo, contexto extra?]] }. A conversa de cada
// número fica em whatsapp_conversas: passo atual, contexto e as opções mostradas (para entender a resposta).
import { randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { canLogin, isBlocked } from './auth.js';
import { q } from './db.js';
import { byNearThenSoon, distanceMeters } from './rules.js';
import { loadFile } from './storage.js';
import { OCC_LABEL as OCORRENCIA } from './penalties.js';
import { avisar, sendOptions, sendWhatsapp, sendWhatsappMediaSafe, whatsappConfig } from './whatsapp.js';
import { wallet } from './routes/carteira.js';
import { candidatar, desistir, WITHDRAW_LIMIT_MS } from './routes/jobs.js';
import { history, openContestation } from './routes/penalties.js';

const TZ = 'America/Sao_Paulo';
const EXPIRA_MS = 30 * 60e3; // conversa parada volta ao Menu
const HUMANO_MS = 4 * 3600e3; // "falar com uma pessoa": o bot fica quieto
const POR_PAGINA = 7; // + "Ver mais", "Outro dia" e "Menu" = 10, o máximo de uma lista do WhatsApp
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');

const dayOf = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ });
const addDays = (key, n) => dayOf(Date.parse(`${key}T12:00:00-03:00`) + n * 86400e3);
const fmtDia = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '').replace(',', '');
const fmtHora = (d) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const first = (name) => String(name).trim().split(/\s+/)[0];
const MENU = ['Menu', 'menu'];
// Conta bloqueada: como no app, só o que o bloqueado pode fazer (sem vagas, diárias nem carteira).
const BLOQUEADO_PODE = new Set(['menu', 'humano', 'ocorrencias', 'ocorrencia', 'contestar_motivo', 'contestar_confirma', 'contestar_ok']);

/** Passo em que o profissional escreve (só para contar um motivo): o texto vira ctx.input e segue para `next`. */
function textoLivre(prompt, next, back) {
  const step = async () => ({ question: prompt, options: [['Cancelar', back]] });
  step.input = next;
  return step;
}

/** Telefone (11 dígitos, com DDD) a partir do número do WhatsApp; celular antigo sem o 9 ganha o 9. */
export function phoneFromJid(jid) {
  let d = String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!d.startsWith('55')) return null;
  d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d.length === 11 ? d : null;
}

// ---------- passos da conversa ----------

const STEPS = {
  async menu(u) {
    if (isBlocked(u)) {
      return {
        text: `Olá, ${first(u.name)}. Sua conta está bloqueada no momento. Veja o motivo e conteste no app: ${APP_URL()}/ocorrencias`,
        question: 'O que você quer fazer?',
        options: [['Ocorrências e contestação', 'ocorrencias'], ['Falar com uma pessoa da UP Service', 'humano']],
      };
    }
    return {
      question: `Olá, ${first(u.name)}! Sou o atendimento da UP Service. O que você quer fazer?`,
      options: [['Procurar vagas', 'vagas_dia'], ['Minhas diárias', 'diarias'], ['Carteira (pagamentos)', 'carteira'], ['Avisos', 'avisos'], ['Ocorrências e contestação', 'ocorrencias'], ['Falar com uma pessoa da UP Service', 'humano']],
    };
  },

  async humano(u) {
    return {
      text: `Certo, ${first(u.name)}! Uma pessoa da UP Service vai responder você por aqui, em horário comercial. Para voltar ao atendimento automático, envie *menu*.`,
    };
  },

  // ----- vagas -----
  async vagas_dia() {
    const hoje = dayOf(Date.now());
    const options = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(hoje, i);
      const nome = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : '';
      return [`${nome ? `${nome} (${fmtDia(`${day}T12:00:00-03:00`)})` : fmtDia(`${day}T12:00:00-03:00`)}`, 'vagas', { day, page: 0 }];
    });
    return { question: 'Para qual dia você procura vaga?', options: [...options, MENU] };
  },

  async vagas(u, c) {
    const jobs = await vagasDoDia(u, c.day);
    const pagina = jobs.slice(c.page * POR_PAGINA, (c.page + 1) * POR_PAGINA);
    if (!jobs.length) return { text: `Não há vagas abertas em ${fmtDia(`${c.day}T12:00:00-03:00`)}.`, question: 'E agora?', options: [['Escolher outro dia', 'vagas_dia'], MENU] };
    const options = pagina.map((j) => [
      `${fmtHora(j.starts_at)}–${fmtHora(j.ends_at)} · ${j.code} · ${j.title} · ${brl(j.daily_value)}${j.available ? '' : ' · reserva'}`,
      'vaga', { jobId: j.id },
    ]);
    if (jobs.length > (c.page + 1) * POR_PAGINA) options.push(['Ver mais vagas', 'vagas', { page: c.page + 1 }]);
    options.push(['Escolher outro dia', 'vagas_dia'], MENU);
    const total = jobs.length > POR_PAGINA ? ` (${c.page * POR_PAGINA + 1}–${c.page * POR_PAGINA + pagina.length} de ${jobs.length})` : '';
    return { question: `Vagas em ${fmtDia(`${c.day}T12:00:00-03:00`)}${total}, das mais perto para as mais longe. Toque numa para ver os detalhes:`, options };
  },

  async vaga(u, c) {
    const [j] = await q(
      `SELECT j.title, j.starts_at, j.ends_at, j.positions, j.daily_value, j.break_count, j.break_minutes, j.is_cashier, j.description,
              un.code, un.name AS unit_name, un.address, (SELECT COUNT(*) FROM applications x WHERE x.job_id = j.id AND x.status = 'APROVADA') AS approved
       FROM jobs j JOIN units un ON un.id = j.unit_id WHERE j.id = ?`, [c.jobId]);
    if (!j) return { text: 'Essa vaga não existe mais.', question: 'E agora?', options: [['Voltar às vagas', 'vagas'], MENU] };
    const livres = Math.max(0, j.positions - Number(j.approved));
    const text = [
      `*${j.title}*${j.is_cashier ? ' (vaga de caixa)' : ''}`,
      `${j.code} · ${j.unit_name}`,
      j.address,
      `${fmtDia(j.starts_at)}, ${fmtHora(j.starts_at)} às ${fmtHora(j.ends_at)}`,
      `Valor: ${brl(j.daily_value)}`,
      j.break_count ? `Pausa: ${j.break_count} de ${j.break_minutes} min` : 'Sem pausa',
      livres ? `${livres} vaga(s) livre(s)` : 'Vaga cheia: você entra na reserva e eu aviso se abrir uma posição.',
    ].filter(Boolean).join('\n');
    return { text, question: 'Quer esta vaga?', options: [['Quero esta vaga', 'vaga_confirma'], ['Voltar às vagas', 'vagas'], MENU] };
  },

  async vaga_confirma(u, c) {
    const [j] = await q('SELECT j.title, j.starts_at, un.code FROM jobs j JOIN units un ON un.id = j.unit_id WHERE j.id = ?', [c.jobId]);
    if (!j) return STEPS.vaga(u, c);
    return { question: `Confirma a candidatura em ${j.title}, ${j.code}, ${fmtDia(j.starts_at)} às ${fmtHora(j.starts_at)}?`, options: [['Sim, quero', 'vaga_ok'], ['Não', 'vagas']] };
  },

  async vaga_ok(u, c) {
    const r = await acao(u, 'WHATSAPP_CANDIDATURA', 'job', c.jobId, (req) => candidatar(req, c.jobId));
    const text = r.erro ? `⚠️ ${r.erro}`
      : r.status === 'APROVADA' ? '✅ Pronto! A diária é sua. No dia, faça o check-in pelo app, dentro da loja.'
      : `Você entrou na reserva (nº ${r.position}). Se abrir uma posição, eu aviso você por aqui.`;
    return { text, question: 'E agora?', options: [['Minhas diárias', 'diarias'], ['Ver mais vagas', 'vagas'], MENU] };
  },

  // ----- minhas diárias -----
  async diarias(u) {
    const rows = await minhasDiarias(u.id);
    if (!rows.length) return { text: 'Você não tem diárias marcadas.', question: 'Quer procurar uma vaga?', options: [['Procurar vagas', 'vagas_dia'], MENU] };
    const options = rows.slice(0, 9).map((a) => [
      `${fmtDia(a.starts_at)} ${fmtHora(a.starts_at)} · ${a.code} · ${a.title}${a.status === 'PENDENTE' ? ` · reserva nº ${a.reserve_position}` : ''}`,
      'diaria', { appId: a.id },
    ]);
    return { question: 'Suas próximas diárias. Toque numa para ver ou desistir:', options: [...options, MENU] };
  },

  async diaria(u, c) {
    const a = (await minhasDiarias(u.id)).find((x) => x.id === c.appId);
    if (!a) return { text: 'Essa diária não está mais na sua lista.', question: 'E agora?', options: [['Minhas diárias', 'diarias'], MENU] };
    const text = [`*${a.title}*`, `${a.code} · ${a.unit_name}`, a.address, `${fmtDia(a.starts_at)}, ${fmtHora(a.starts_at)} às ${fmtHora(a.ends_at)}`, `Valor: ${brl(a.daily_value)}`,
      a.status === 'PENDENTE' ? `Você está na reserva (nº ${a.reserve_position}).` : 'Confirmada ✅'].filter(Boolean);
    const options = [];
    if (a.status === 'PENDENTE') options.push(['Sair da reserva', 'diaria_confirma']);
    else if (a.session_status === 'AGUARDANDO_CHECKIN' && new Date(a.starts_at) - Date.now() >= WITHDRAW_LIMIT_MS) options.push(['Desistir desta diária', 'diaria_confirma']);
    else if (a.session_status === 'AGUARDANDO_CHECKIN') text.push('Faltam menos de 2 horas: para desistir, fale com a loja.');
    if (a.session_id && a.session_status !== 'AGUARDANDO_CHECKIN' || (a.session_id && dayOf(a.starts_at) === dayOf(Date.now()))) text.push(`Check-in, pausa e checkout pelo app: ${APP_URL()}/atividade/${a.session_id}`);
    return { text: text.join('\n'), question: 'E agora?', options: [...options, ['Voltar às diárias', 'diarias'], MENU] };
  },

  async diaria_confirma(u, c) {
    const a = (await minhasDiarias(u.id)).find((x) => x.id === c.appId);
    if (!a) return STEPS.diaria(u, c);
    const o = a.status === 'PENDENTE' ? 'sair da reserva de' : 'desistir de';
    return { question: `Tem certeza que quer ${o} ${a.title}, ${a.code}, ${fmtDia(a.starts_at)} às ${fmtHora(a.starts_at)}?`, options: [['Sim, tenho certeza', 'diaria_ok'], ['Não', 'diarias']] };
  },

  async diaria_ok(u, c) {
    const r = await acao(u, 'WHATSAPP_DESISTENCIA', 'application', c.appId, (req) => desistir(req, c.appId));
    return { text: r.erro ? `⚠️ ${r.erro}` : 'Feito. Você saiu desta diária. A vaga foi para a próxima pessoa da reserva.', question: 'E agora?', options: [['Minhas diárias', 'diarias'], ['Procurar vagas', 'vagas_dia'], MENU] };
  },

  // ----- carteira -----
  async carteira(u) {
    const w = await wallet(u.id);
    const [p] = await q('SELECT pix_type, pix_key FROM worker_profiles WHERE user_id = ?', [u.id]);
    const text = [
      `*A receber: ${brl(w.aReceber)}*`,
      `Diárias concluídas: ${brl(w.diarias)}`,
      `Bônus ganhos: ${brl(w.bonus)}`,
      w.quebras ? `Quebra de caixa: − ${brl(w.quebras)}` : null,
      `Já recebido: − ${brl(w.pago)}`,
      '',
      p?.pix_key ? `Chave Pix: ${p.pix_key}` : 'Você ainda não cadastrou a chave Pix.',
      `Para cadastrar ou trocar a chave: ${APP_URL()}/cadastro`,
    ].filter((x) => x !== null).join('\n');
    const options = [w.pagamentos.length && ['Recebidos e comprovantes', 'recebidos'], w.abatimentos.length && ['Quebras de caixa', 'quebras'], MENU].filter(Boolean);
    return { text, question: w.pagamentos.length ? 'Quer ver os pagamentos recebidos?' : 'Nenhum pagamento recebido ainda.', options };
  },

  // ----- quebra de caixa: ver e pedir revisão (uma por quebra, decisão final) -----
  async quebras(u) {
    const w = await wallet(u.id);
    if (!w.abatimentos.length) return { text: 'Você não tem quebra de caixa.', question: 'E agora?', options: [['Carteira', 'carteira'], MENU] };
    const options = w.abatimentos.slice(0, 8).map((a) => [`${fmtDia(a.date)} · ${brl(a.finalAmount ?? a.amount)}${a.status === 'CANCELADA' ? ' · cancelada' : a.review ? ' · revisão' : ''}`, 'quebra', { breakId: a.id }]);
    return { question: 'Quebras de caixa. Toque numa para ver o motivo ou pedir revisão:', options: [...options, ['Carteira', 'carteira'], MENU] };
  },

  async quebra(u, c) {
    const a = (await wallet(u.id)).abatimentos.find((x) => x.id === c.breakId);
    if (!a) return { text: 'Essa quebra de caixa não está mais na sua lista.', question: 'E agora?', options: [['Carteira', 'carteira'], MENU] };
    const text = [
      `*Quebra de caixa: ${brl(a.finalAmount ?? a.amount)}*${a.finalAmount != null && a.finalAmount !== a.amount ? ` (era ${brl(a.amount)})` : ''}`,
      `${fmtDia(a.date)} · ${a.text}`,
      `Motivo: ${a.reason}`,
      a.status === 'CANCELADA' ? `Cancelada${a.cancelReason ? `: ${a.cancelReason}` : ''}. O valor voltou para o seu A receber.` : null,
      a.review ? `Revisão ${a.review.protocol}: ${a.review.status === 'ABERTA' ? 'em análise' : 'decidida'}${a.review.reason ? ` · ${a.review.reason}` : ''}` : null,
    ].filter(Boolean).join('\n');
    const pode = a.status === 'ATIVA' && !a.review;
    return { text, question: pode ? 'Não concorda? Você pode pedir uma revisão (uma vez só).' : 'E agora?', options: [pode && ['Pedir revisão', 'quebra_motivo'], ['Quebras de caixa', 'quebras'], MENU].filter(Boolean) };
  },

  quebra_motivo: textoLivre('Escreva numa mensagem por que você não concorda com a quebra de caixa (pelo menos 10 letras).', 'quebra_confirma', 'quebra'),

  async quebra_confirma(u, c) {
    return { text: `Seu pedido de revisão:\n"${c.input}"`, question: 'Enviar o pedido de revisão?', options: [['Sim, enviar', 'quebra_ok'], ['Não, cancelar', 'quebra']] };
  },

  async quebra_ok(u, c) {
    const r = await acao(u, 'WHATSAPP_REVISAO_QUEBRA', 'cash_break', c.breakId, (req) => openContestation(req, { userId: u.id, cashBreakId: c.breakId, message: c.input, channel: 'WHATSAPP' }));
    return { text: r.erro ? `⚠️ ${r.erro}` : `✅ Pedido de revisão enviado (protocolo ${r.protocol}). Você recebe a decisão por aqui e no app.`, question: 'E agora?', options: [['Carteira', 'carteira'], MENU] };
  },

  // ----- ocorrências, bloqueios e contestação (o bloqueado também usa) -----
  async ocorrencias(u) {
    const h = await history(u.id);
    const itens = [
      ...h.penalties.filter((p) => p.status === 'ATIVA').map((p) => [`Bloqueio ${p.type === 'BLOQUEIO_PERMANENTE' ? 'permanente' : `até ${fmtDia(p.ends_at)}`}`, 'ocorrencia', { penaltyId: p.id }]),
      ...h.occurrences.filter((o) => o.status === 'CONFIRMADA').slice(0, 9).map((o) => [`${fmtDia(o.created_at)} · ${OCORRENCIA[o.type] ?? o.type}`, 'ocorrencia', { occurrenceId: o.id }]),
    ];
    const text = `Faltas e ocorrências que contam: ${h.strikes} de ${h.strikesToBlock} (com ${h.strikesToBlock}, a conta é bloqueada por 15 dias).`;
    if (!itens.length) return { text: `${text}\nVocê não tem ocorrências. 👏`, question: 'E agora?', options: [MENU] };
    return { text, question: 'Toque numa para ver o detalhe ou contestar:', options: [...itens.slice(0, 9), MENU] };
  },

  async ocorrencia(u, c) {
    const h = await history(u.id);
    const p = c.penaltyId && h.penalties.find((x) => x.id === c.penaltyId);
    const o = c.occurrenceId && h.occurrences.find((x) => x.id === c.occurrenceId);
    if (!p && !o) return { text: 'Não encontrei esse item.', question: 'E agora?', options: [['Ocorrências', 'ocorrencias'], MENU] };
    const contest = h.contestations.find((x) => (p && x.penalty_id === p.id) || (o && x.occurrence_id === o.id));
    const text = [
      p ? `*Bloqueio ${p.type === 'BLOQUEIO_PERMANENTE' ? 'permanente' : `de ${fmtDia(p.starts_at)} a ${fmtDia(p.ends_at)}`}*` : `*${OCORRENCIA[o.type] ?? o.type}* · ${fmtDia(o.created_at)}${o.unit_name ? ` · ${o.unit_name}` : ''}`,
      p ? `Motivo: ${p.reason}` : o.description,
      contest ? `Contestação ${contest.protocol}: ${contest.status === 'ABERTA' ? 'em análise' : `decidida${contest.decision_reason ? ` · ${contest.decision_reason}` : ''}`}` : null,
    ].filter(Boolean).join('\n');
    const pode = !contest && (p ? p.status === 'ATIVA' : o.status === 'CONFIRMADA');
    return { text, question: pode ? 'Quer contestar? A UP Service analisa e responde.' : 'E agora?', options: [pode && ['Contestar', 'contestar_motivo'], ['Ocorrências', 'ocorrencias'], MENU].filter(Boolean) };
  },

  contestar_motivo: textoLivre('Escreva numa mensagem o que aconteceu e por que você contesta (pelo menos 10 letras). Se tiver atestado, diga aqui e envie pelo e-mail contato@upserviceintermed.com.', 'contestar_confirma', 'ocorrencia'),

  async contestar_confirma(u, c) {
    return { text: `Sua contestação:\n"${c.input}"`, question: 'Enviar a contestação?', options: [['Sim, enviar', 'contestar_ok'], ['Não, cancelar', 'ocorrencia']] };
  },

  async contestar_ok(u, c) {
    const r = await acao(u, 'WHATSAPP_CONTESTACAO', c.penaltyId ? 'penalty' : 'occurrence', c.penaltyId ?? c.occurrenceId,
      (req) => openContestation(req, { userId: u.id, penaltyId: c.penaltyId, occurrenceId: c.occurrenceId, message: c.input, channel: 'WHATSAPP' }));
    return { text: r.erro ? `⚠️ ${r.erro}` : `✅ Contestação enviada (protocolo ${r.protocol}). A UP Service analisa e você recebe a resposta no app.`, question: 'E agora?', options: [['Ocorrências', 'ocorrencias'], MENU] };
  },

  // ----- avisos do app -----
  async avisos(u) {
    const rows = await q('SELECT id, title, body, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [u.id]);
    if (!rows.length) return { text: 'Você não tem avisos.', question: 'E agora?', options: [MENU] };
    await q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [new Date(), u.id]);
    return { text: rows.map((n) => `*${n.title}* (${fmtDia(n.created_at)})${n.body ? `\n${n.body}` : ''}`).join('\n\n'), question: 'Seus últimos avisos. E agora?', options: [MENU] };
  },

  // ----- botão "Vou" do lembrete da véspera (modelo lembrete_vespera) -----
  async vou() {
    return { text: 'Combinado! 👍 No dia, chegue um pouco antes: o check-in abre 15 minutos antes do início, pelo app, dentro da loja. Eu aviso você quando abrir.' };
  },

  async recebidos(u) {
    const w = await wallet(u.id);
    const options = w.pagamentos.slice(0, 8).map((p) => [`${fmtDia(p.paidAt)} · ${brl(p.amount)}${p.receipt ? '' : ' · sem comprovante'}`, 'comprovante', { payId: p.id }]);
    return { question: 'Pagamentos recebidos. Toque num para receber o comprovante:', options: [...options, ['Carteira', 'carteira'], MENU] };
  },

  async comprovante(u, c, phone) {
    const [p] = await q('SELECT amount, paid_at, receipt_key, receipt_mime FROM worker_payments WHERE id = ? AND user_id = ?', [c.payId, u.id]);
    let text = 'Esse pagamento não tem comprovante anexado.';
    if (p?.receipt_key) {
      const buf = await loadFile(p.receipt_key).catch(() => null);
      if (buf) {
        await sendWhatsappMediaSafe(phone, { buf, mime: p.receipt_mime, fileName: `comprovante-upservice.${p.receipt_mime === 'application/pdf' ? 'pdf' : p.receipt_mime.split('/')[1]}`, caption: `Comprovante do pagamento de ${brl(p.amount)} (${fmtDia(p.paid_at)}).` });
        text = null;
      }
    }
    return { text, question: 'Quer outro comprovante?', options: [['Outro comprovante', 'recebidos'], MENU] };
  },
};

// ---------- consultas ----------

/** Vagas abertas do dia, sem as que ele já pegou ou pediu; das mais perto (último local de check-in) para as mais longe. */
async function vagasDoDia(u, day) {
  const rows = await q(
    `SELECT j.id, j.title, j.starts_at, j.ends_at, j.positions, j.daily_value, un.code, un.lat, un.lng,
            (SELECT COUNT(*) FROM applications x WHERE x.job_id = j.id AND x.status = 'APROVADA') AS approved
     FROM jobs j JOIN units un ON un.id = j.unit_id
     WHERE j.status = 'ABERTA' AND un.status = 'ATIVA' AND j.starts_at > ? AND j.starts_at >= ? AND j.starts_at < ?
       AND NOT EXISTS (SELECT 1 FROM applications y WHERE y.job_id = j.id AND y.user_id = ?)
     ORDER BY j.starts_at LIMIT 300`,
    [new Date(), new Date(`${day}T00:00:00-03:00`), new Date(`${addDays(day, 1)}T00:00:00-03:00`), u.id],
  );
  const [here] = await q('SELECT lat, lng FROM presence_events WHERE actor_user_id = ? ORDER BY occurred_at DESC LIMIT 1', [u.id]);
  const jobs = rows.map((j) => ({ ...j, available: Math.max(0, j.positions - Number(j.approved)), distance_m: here ? Math.round(distanceMeters(here, j)) : null }));
  if (here) jobs.sort(byNearThenSoon);
  return jobs;
}

/** Próximas diárias e reservas (mesmo critério da tela "Minhas diárias"). */
const minhasDiarias = (userId) => q(
  `SELECT a.id, a.status, j.title, j.starts_at, j.ends_at, j.daily_value, un.code, un.name AS unit_name, un.address, ws.id AS session_id, ws.status AS session_status,
          (SELECT COUNT(*) FROM applications r WHERE r.job_id = a.job_id AND r.status = 'PENDENTE'
             AND (r.created_at < a.created_at OR (r.created_at = a.created_at AND r.id <= a.id))) AS reserve_position
   FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id
   LEFT JOIN work_sessions ws ON ws.application_id = a.id
   LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
   WHERE a.user_id = ? AND dc.application_id IS NULL AND (a.status = 'PENDENTE' AND j.starts_at > ? OR a.status = 'APROVADA'
     AND ws.status IN ('AGUARDANDO_CHECKIN', 'EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA', 'PENDENTE_DE_EXCECAO', 'PENDENTE_DE_FECHAMENTO'))
   ORDER BY j.starts_at LIMIT 20`,
  [userId, new Date()],
);

/** Executa uma ação do app em nome do profissional; erro de regra vira mensagem; tudo fica na auditoria (canal WhatsApp). */
async function acao(u, action, entity, id, fn) {
  const req = { user: u, id: randomUUID() };
  try {
    const r = (await fn(req)) ?? {};
    await audit(q, req, action, entity, id);
    return r;
  } catch (e) {
    if (e.status && e.status < 500) return { erro: e.message };
    throw e;
  }
}

// ---------- entender a resposta ----------

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const RESET = new Set(['menu', 'oi', 'ola', 'inicio', 'comecar', 'bom dia', 'boa tarde', 'boa noite', '0']);
// Botões de resposta dos avisos (modelos): o toque volta com { s: passo, c: { appId } } e a conversa segue dali.
const PELO_AVISO = new Set(['vou', 'diaria_confirma', 'quebras']);

/** Índice da opção escolhida: número digitado (o toque num botão ou na lista chega como o número) ou texto igual ao rótulo. */
export function escolha(labels, { text }) {
  const t = norm(text);
  if (/^\d{1,2}$/.test(t)) return Number(t) - 1 < labels.length ? Number(t) - 1 : -1;
  return labels.findIndex((l) => norm(l) === t || norm(l.replace(/^\d+\.\s*/, '')) === t);
}

// ---------- conversa ----------

const numbered = (opts) => opts.map(([label], i) => `${i + 1}. ${label}`);

async function show(phone, u, step, c) {
  const out = await STEPS[step](u, c, phone);
  if (out.text) await sendWhatsapp(phone, out.text);
  const options = out.options ?? [];
  let pollId = null;
  if (options.length) pollId = await sendOptions(phone, out.question, numbered(options));
  else if (out.question) await sendWhatsapp(phone, out.question);
  await q(
    `INSERT INTO whatsapp_conversas (phone, user_id, step, ctx, options, poll_id, updated_at) VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), step = VALUES(step), ctx = VALUES(ctx), options = VALUES(options), poll_id = VALUES(poll_id), updated_at = VALUES(updated_at)`,
    [phone, u.id, step, JSON.stringify(c), JSON.stringify(options), pollId, new Date()],
  );
}

// Respostas a número desconhecido: no máximo uma a cada 12 h (evita conversa sem fim com quem não tem conta).
const avisados = new Map();
// ponytail: limite e deduplicação em memória (um processo só); passar para o banco se o app rodar em várias instâncias.
const vistos = new Set();
const contagem = new Map();
const fila = new Map();

/** Chamada do webhook da Meta: mensagens recebidas (texto, toque em botão ou na lista) e situação das enviadas. */
export async function handleWebhook(body) {
  const values = (body?.entry ?? []).flatMap((e) => e?.changes ?? []).filter((c) => c?.field === 'messages').map((c) => c.value ?? {});
  // Mensagem que não chegou (número sem WhatsApp, modelo pausado…): só no log, sem o número inteiro.
  for (const s of values.flatMap((v) => v.statuses ?? [])) {
    if (s?.status === 'failed') console.error(`whatsapp: não entregue para …${String(s.recipient_id ?? '').slice(-4)}:`, (s.errors ?? []).map((e) => `${e.code} ${e.title ?? e.message ?? ''}`).join('; '));
  }
  const msgs = values.flatMap((v) => v.messages ?? []);
  if (!msgs.length || !(await botConfig()).enabled) return;
  for (const m of msgs) {
    const phone = phoneFromJid(m?.from);
    if (!phone) continue;
    const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
    const text = m.text?.body ?? reply?.id ?? m.button?.text ?? null;
    let payload = null;
    try { payload = m.button?.payload ? JSON.parse(m.button.payload) : null; } catch { /* botão sem payload nosso: vale o texto */ }
    if (text == null) {
      console.log('whatsapp-bot: mensagem sem texto', m.type);
      continue;
    }
    if (vistos.has(m.id)) continue;
    vistos.add(m.id);
    if (vistos.size > 2000) vistos.delete(vistos.values().next().value);
    // Uma conversa por vez por número, na ordem de chegada.
    const prev = fila.get(phone) ?? Promise.resolve();
    const next = prev.then(() => responder(phone, { text, payload })).catch((e) => console.error('whatsapp-bot', e.message));
    fila.set(phone, next);
    next.finally(() => { if (fila.get(phone) === next) fila.delete(phone); });
  }
}

async function responder(phone, msg) {
  // Limite: 40 mensagens a cada 10 min por número.
  const now = Date.now();
  const c0 = contagem.get(phone);
  const cnt = c0 && now - c0.at < 10 * 60e3 ? c0 : { at: now, n: 0 };
  cnt.n += 1;
  contagem.set(phone, cnt);
  if (cnt.n > 40) return;

  const [u] = await q("SELECT id, name, role, status FROM users WHERE whatsapp = ? AND whatsapp_verified_at IS NOT NULL", [phone]);
  // Mesmas regras do login do app: inativo não é atendido; bloqueado fica restrito (BLOQUEADO_PODE).
  if (!u || u.role !== 'PROFISSIONAL' || !canLogin(u)) {
    if ((avisados.get(phone) ?? 0) > now - 12 * 3600e3) return;
    avisados.set(phone, now);
    await sendWhatsapp(phone, !u
      ? `Olá! Aqui é a UP Service. Para usar o atendimento pelo WhatsApp, entre no app e confirme este número em *Meu perfil → WhatsApp*: ${APP_URL()}/perfil`
      : u.role !== 'PROFISSIONAL' ? 'Olá! Este atendimento automático é para os profissionais. Para a gestão, use o app.'
      : 'Olá! Sua conta não está ativa no momento. Fale com a UP Service pelo e-mail contato@upserviceintermed.com.');
    return;
  }

  const [conv] = await q('SELECT step, ctx, options, updated_at FROM whatsapp_conversas WHERE phone = ?', [phone]);
  const age = conv ? now - new Date(conv.updated_at).getTime() : Infinity;
  const t = norm(msg.text);
  // "Falar com uma pessoa": o bot fica quieto até a pessoa mandar "menu" (ou passarem 4 h).
  if (conv?.step === 'humano' && age < HUMANO_MS && t !== 'menu') return;
  // Toque num botão de aviso ("Vou", "Não vou"…): segue no passo dele. Os passos conferem que a diária é da pessoa.
  const p = msg.payload;
  if (p && PELO_AVISO.has(p.s)) {
    if (isBlocked(u) && !BLOQUEADO_PODE.has(p.s)) return show(phone, u, 'menu', {});
    return show(phone, u, p.s, typeof p.c?.appId === 'string' ? { appId: p.c.appId } : {});
  }
  if (!conv || age > EXPIRA_MS || RESET.has(t)) return show(phone, u, 'menu', {});

  const options = JSON.parse(conv.options ?? '[]');
  if (!options.length) return show(phone, u, 'menu', {}); // passo sem pergunta (ex.: "Combinado!"): recomeça
  const i = escolha(numbered(options), msg);
  // Passo de escrever: o que não for uma das opções é o texto (o motivo).
  const input = STEPS[conv.step]?.input;
  if (i < 0 && input) {
    if (isBlocked(u) && !BLOQUEADO_PODE.has(input)) return show(phone, u, 'menu', {});
    return show(phone, u, input, { ...JSON.parse(conv.ctx ?? '{}'), input: msg.text.trim().slice(0, 1000) });
  }
  if (i < 0) {
    // Repete só as opções: refazer o passo repetiria a ação dele (desistir, candidatar, contestar).
    await sendWhatsapp(phone, 'Não entendi. Toque numa opção ou responda só com o número. Para recomeçar, envie *menu*.');
    await sendOptions(phone, 'Escolha uma opção:', numbered(options));
    await q('UPDATE whatsapp_conversas SET updated_at = ? WHERE phone = ?', [new Date(), phone]);
    return;
  }
  const [, next, extra] = options[i];
  // Opção de uma conversa de antes do bloqueio: o bloqueado volta ao Menu restrito.
  if (isBlocked(u) && !BLOQUEADO_PODE.has(next)) return show(phone, u, 'menu', {});
  const ctx = next === 'menu' ? {} : { ...JSON.parse(conv.ctx ?? '{}'), ...(extra ?? {}) };
  return show(phone, u, next, ctx);
}

// ---------- avisos e lembretes (o sistema fala primeiro) ----------

export async function botConfig() {
  const [row] = await q("SELECT value FROM app_settings WHERE name = 'whatsapp_bot'");
  return row ? JSON.parse(row.value) : { enabled: false };
}

/** Marca o lembrete como enviado; devolve false se já tinha ido (um por diária e tipo, mesmo com várias varreduras). */
const marcar = async (appId, kind) => (await q('INSERT IGNORE INTO whatsapp_lembretes (application_id, kind) VALUES (?, ?)', [appId, kind])).affectedRows === 1;
const quando = (d) => (dayOf(d) === dayOf(Date.now()) ? 'Hoje' : dayOf(d) === addDays(dayOf(Date.now()), 1) ? 'Amanhã' : fmtDia(d));

/** Lembretes pela varredura periódica: véspera (Vou / Não vou), check-in abrindo e pausa acabando. */
export async function lembretes(now = new Date()) {
  if (!(await whatsappConfig())?.token) return;
  const t = now.getTime();
  const base = `FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id JOIN work_sessions ws ON ws.application_id = a.id
                JOIN users u ON u.id = a.user_id AND u.whatsapp_verified_at IS NOT NULL`;
  // Véspera: de 24 h a 2 h antes, entre 8h e 21h (sem acordar ninguém), para quem pegou a vaga há mais de 6 h.
  const hora = Number(now.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  if (hora >= 8 && hora < 21) {
    const rows = await q(
      `SELECT a.id, a.user_id, j.title, j.starts_at, un.code, un.name AS unit_name ${base}
       WHERE a.status = 'APROVADA' AND ws.status = 'AGUARDANDO_CHECKIN' AND j.starts_at BETWEEN ? AND ? AND a.created_at < ?
         AND NOT EXISTS (SELECT 1 FROM whatsapp_lembretes l WHERE l.application_id = a.id AND l.kind = 'VESPERA')`,
      [new Date(t + 2 * 3600e3), new Date(t + 24 * 3600e3), new Date(t - 6 * 3600e3)],
    );
    for (const r of rows) {
      if (await marcar(r.id, 'VESPERA')) {
        await avisar(r.user_id, 'lembrete_vespera', { vars: [quando(r.starts_at), fmtHora(r.starts_at), r.title, `${r.code} · ${r.unit_name}`], respostas: [{ s: 'vou', c: { appId: r.id } }, { s: 'diaria_confirma', c: { appId: r.id } }] });
      }
    }
  }
  // Check-in abrindo: 15 min antes do início (até o fim da janela, 15 min depois).
  for (const r of await q(
    `SELECT a.id, a.user_id, ws.id AS session_id, j.title, j.starts_at, un.code ${base}
     WHERE a.status = 'APROVADA' AND ws.status = 'AGUARDANDO_CHECKIN' AND j.starts_at BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM whatsapp_lembretes l WHERE l.application_id = a.id AND l.kind = 'CHECKIN')`,
    [new Date(t - 15 * 60e3), new Date(t + 15 * 60e3)],
  )) {
    if (await marcar(r.id, 'CHECKIN')) await avisar(r.user_id, 'checkin_aberto', { vars: [r.title, r.code, fmtHora(r.starts_at)], link: `atividade/${r.session_id}` });
  }
  // Pausa acabando: 2 min antes do fim (uma vez por pausa).
  for (const r of await q(
    `SELECT a.id, a.user_id, ws.id AS session_id, ws.breaks_used, ws.break_ends_at ${base}
     WHERE ws.status = 'EM_PAUSA' AND ws.break_ends_at BETWEEN ? AND ?`,
    [new Date(t - 60e3), new Date(t + 2 * 60e3)],
  )) {
    if (await marcar(r.id, `PAUSA${r.breaks_used}`)) await avisar(r.user_id, 'pausa_terminando', { vars: [fmtHora(r.break_ends_at)], link: `atividade/${r.session_id}` });
  }
}
