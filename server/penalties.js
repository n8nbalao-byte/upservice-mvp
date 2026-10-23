// Ocorrências, bloqueios e reativação (v4.0 §4–§6). As funções recebem um contexto de transação
// { tq, req, outbox, whatsapp }; e-mails e WhatsApp ficam guardados e só saem depois do commit (flush), para não avisar algo desfeito.
import { randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { sendMailSafe } from './mail.js';
import { avisar } from './whatsapp.js';
import { BLOCK_DAYS, STRIKES_TO_BLOCK } from './rules.js';
import { promoteFromWaitlist } from './staffing.js';

export const ctx = (tq, req) => ({ tq, req, outbox: [], whatsapp: [] });

export async function flush(c) {
  for (const [to, subject, text] of c.outbox) await sendMailSafe(to, subject, text);
  // [userId, modelo, variáveis do modelo] (whatsappModelos.js).
  for (const [userId, modelo, opts] of c.whatsapp) await avisar(userId, modelo, opts);
}

export const managerEmails = async (tq, unitId) =>
  (await tq("SELECT u.email FROM unit_managers m JOIN users u ON u.id = m.user_id WHERE m.unit_id = ? AND m.active = 1 AND u.status = 'ATIVO'", [unitId])).map((r) => r.email);

export const OCC_LABEL = {
  FALTA: 'Falta', CHECKOUT_AUSENTE: 'Checkout ausente', PAUSA_EXCEDIDA: 'Pausa excedida',
  ABANDONO: 'Abandono de atividade', FRAUDE: 'Tentativa de fraude', REGRA_OPERACIONAL: 'Descumprimento de regra operacional',
};
const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const CONTEST = 'Você pode contestar pelo app (menu Ocorrências) ou pelo e-mail contato@upserviceintermed.com.';

const worker = async (tq, userId) => (await tq('SELECT id, email, name FROM users WHERE id = ?', [userId]))[0];

/** Bloqueio ativo sempre prevalece; sem bloqueio, volta a ATIVO só quem estava bloqueado (não mexe em INATIVO/EM_ANALISE). */
async function refreshUserStatus(c, userId) {
  const [p] = await c.tq("SELECT COALESCE(SUM(type = 'BLOQUEIO_PERMANENTE'), 0) AS perm, COALESCE(SUM(type = 'BLOQUEIO_TEMPORARIO'), 0) AS temp FROM penalties WHERE user_id = ? AND status = 'ATIVA'", [userId]);
  if (Number(p.perm) || Number(p.temp)) {
    await c.tq('UPDATE users SET status = ? WHERE id = ?', [Number(p.perm) ? 'BLOQUEADO_PERMANENTEMENTE' : 'BLOQUEADO_TEMPORARIAMENTE', userId]);
  } else {
    await c.tq("UPDATE users SET status = 'ATIVO' WHERE id = ? AND status IN ('BLOQUEADO_TEMPORARIAMENTE', 'BLOQUEADO_PERMANENTEMENTE')", [userId]);
  }
}

export async function applyBlock(c, { userId, type, reason, days = null }) {
  const now = new Date();
  const penalty = {
    id: randomUUID(), user_id: userId, type, reason, starts_at: now,
    ends_at: days ? new Date(now.getTime() + days * 86400e3) : null, status: 'ATIVA', created_by: c.req?.user?.id ?? null,
  };
  await c.tq('INSERT INTO penalties SET ?', [penalty]);
  await refreshUserStatus(c, userId);
  await audit(c.tq, c.req, 'PENALTY_APPLY', 'penalty', penalty.id, { after: { userId, type, ends_at: penalty.ends_at }, reason });

  // Libera as vagas aprovadas que ainda não começaram (decisão de 14/10/2026).
  const future = await c.tq(
    `SELECT a.id, a.job_id, ws.id AS session_id, j.title, j.starts_at, j.unit_id, un.name AS unit_name
     FROM applications a JOIN work_sessions ws ON ws.application_id = a.id JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id
     WHERE a.user_id = ? AND a.status = 'APROVADA' AND ws.status = 'AGUARDANDO_CHECKIN' AND j.starts_at > ? FOR UPDATE`,
    [userId, now],
  );
  const w = await worker(c.tq, userId);
  for (const f of future) {
    await c.tq("UPDATE applications SET status = 'CANCELADA', cancel_reason = 'Profissional bloqueado' WHERE id = ?", [f.id]);
    await c.tq("UPDATE work_sessions SET status = 'CANCELADA_ADMINISTRATIVAMENTE' WHERE id = ?", [f.session_id]);
    await audit(c.tq, c.req, 'APPLICATION_CANCEL', 'application', f.id, { before: { status: 'APROVADA' }, after: { status: 'CANCELADA' }, reason: 'Profissional bloqueado' });
    for (const to of await managerEmails(c.tq, f.unit_id)) {
      c.outbox.push([to, `UpService: posição liberada em ${f.unit_name}`, `${w.name} foi bloqueado(a) e a aprovação na vaga "${f.title}" (${fmt(f.starts_at)}) foi cancelada. Quem estava na reserva é chamado automaticamente.`]);
    }
    await promoteFromWaitlist(c, f.job_id);
  }

  const period = penalty.ends_at ? `de ${fmt(now)} até ${fmt(penalty.ends_at)}` : 'por tempo indeterminado (bloqueio permanente)';
  c.outbox.push([w.email, 'UpService: sua conta foi bloqueada', `Olá, ${w.name}.\n\nSua conta foi bloqueada ${period}.\nMotivo: ${reason}\n\n${CONTEST}`]);
  return penalty;
}

/** how: ENCERRADA (fim do prazo ou reativação) ou CANCELADA (bloqueio anulado). */
export async function endBlock(c, penalty, how, reason) {
  await c.tq('UPDATE penalties SET status = ?, ended_at = ?, ended_by = ?, end_reason = ? WHERE id = ? AND status = ?', [how, new Date(), c.req?.user?.id ?? null, reason, penalty.id, 'ATIVA']);
  await refreshUserStatus(c, penalty.user_id);
  await audit(c.tq, c.req, 'PENALTY_END', 'penalty', penalty.id, { before: { status: 'ATIVA' }, after: { status: how }, reason });
  const w = await worker(c.tq, penalty.user_id);
  c.outbox.push([w.email, 'UpService: sua conta foi reativada', `Olá, ${w.name}.\n\nSeu bloqueio foi ${how === 'CANCELADA' ? 'cancelado' : 'encerrado'}.\nMotivo: ${reason}\n\nVocê já pode se candidatar a vagas novamente.`]);
}

export async function checkThreeStrikes(c, userId) {
  const strikes = await c.tq("SELECT id FROM occurrences WHERE user_id = ? AND type = 'FALTA' AND status = 'CONFIRMADA' AND penalty_id IS NULL ORDER BY created_at FOR UPDATE", [userId]);
  if (strikes.length < STRIKES_TO_BLOCK) return null;
  const penalty = await applyBlock(c, { userId, type: 'BLOQUEIO_TEMPORARIO', reason: `${STRIKES_TO_BLOCK} faltas confirmadas`, days: BLOCK_DAYS });
  await c.tq('UPDATE occurrences SET penalty_id = ? WHERE id IN (?)', [penalty.id, strikes.map((s) => s.id)]);
  return penalty;
}

/** 1ª ocorrência confirmada = aviso; 2ª = revisão do gestor; faltas contam para o bloqueio. */
async function afterConfirm(c, occ) {
  const w = await worker(c.tq, occ.user_id);
  c.outbox.push([w.email, `UpService: ocorrência registrada — ${OCC_LABEL[occ.type]}`, `Olá, ${w.name}.\n\nFoi registrada uma ocorrência na sua conta: ${OCC_LABEL[occ.type]}.${occ.description ? `\nDetalhes: ${occ.description}` : ''}\n\n${CONTEST}`]);
  const [{ n }] = await c.tq("SELECT COUNT(*) AS n FROM occurrences WHERE user_id = ? AND status = 'CONFIRMADA' AND penalty_id IS NULL", [occ.user_id]);
  if (Number(n) === 2) {
    for (const to of await managerEmails(c.tq, occ.unit_id)) {
      c.outbox.push([to, `UpService: revisar ${w.name}`, `${w.name} chegou à 2ª ocorrência confirmada (última: ${OCC_LABEL[occ.type]}). Revise o histórico no menu Ocorrências.`]);
    }
  }
  await checkThreeStrikes(c, occ.user_id);
}

export async function createOccurrence(c, o) {
  const confirmed = o.status === 'CONFIRMADA';
  const occ = {
    id: randomUUID(), user_id: o.userId, unit_id: o.unitId, work_session_id: o.sessionId ?? null, application_id: o.applicationId ?? null,
    type: o.type, description: o.description ?? null, status: o.status ?? 'PENDENTE', created_by: c.req?.user?.id ?? null,
    confirmed_by: confirmed ? c.req?.user?.id ?? null : null, confirmed_at: confirmed ? new Date() : null,
  };
  await c.tq('INSERT INTO occurrences SET ?', [occ]);
  await audit(c.tq, c.req, 'OCCURRENCE_CREATE', 'occurrence', occ.id, { after: { userId: occ.user_id, type: occ.type, status: occ.status } });
  if (confirmed) await afterConfirm(c, occ);
  return occ;
}

export async function decideOccurrence(c, occ, decision, reason) {
  await c.tq('UPDATE occurrences SET status = ?, confirmed_by = ?, confirmed_at = ?, decision_reason = ? WHERE id = ?', [decision, c.req.user.id, new Date(), reason, occ.id]);
  await audit(c.tq, c.req, 'OCCURRENCE_DECIDE', 'occurrence', occ.id, { before: { status: occ.status }, after: { status: decision }, reason });
  if (decision === 'CONFIRMADA') return afterConfirm(c, { ...occ, status: decision });
  // Falta anulada que tinha gerado bloqueio: se sobrarem menos de 3, o bloqueio cai junto.
  if (occ.penalty_id) {
    const [{ n }] = await c.tq("SELECT COUNT(*) AS n FROM occurrences WHERE penalty_id = ? AND status = 'CONFIRMADA'", [occ.penalty_id]);
    const [p] = await c.tq("SELECT * FROM penalties WHERE id = ? AND status = 'ATIVA'", [occ.penalty_id]);
    if (p && Number(n) < STRIKES_TO_BLOCK) await endBlock(c, p, 'CANCELADA', 'Falta que gerou o bloqueio foi cancelada');
  }
}
