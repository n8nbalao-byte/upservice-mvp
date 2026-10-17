// Preenchimento das vagas sem aprovação manual (operação em escala, ~850 diárias/dia):
// profissional habilitado entra direto por ordem de chegada; vaga cheia vira reserva (PENDENTE),
// promovida sozinha quando uma posição é liberada. As funções recebem o contexto { tq, req, outbox } de penalties.js.
import { randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { fail } from './http.js';
import { DOC_TYPES } from './routes/worker.js';

const APP_URL = () => process.env.APP_URL || 'https://app.upserviceintermed.com';
const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/**
 * Motivo pelo qual o profissional ainda não pode ser aprovado; null = habilitado. Trava a linha do usuário (FOR UPDATE):
 * um bloqueio simultâneo (applyBlock atualiza users antes de liberar as vagas) espera ou é esperado, nunca os dois passam.
 */
export async function notEligible(tq, userId) {
  const [u] = await tq(
    `SELECT u.status, p.terms_accepted_at,
            (SELECT COUNT(DISTINCT d.type) FROM worker_documents d WHERE d.user_id = u.id AND d.status = 'APROVADO' AND d.type IN (?)) AS docs_ok
     FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id WHERE u.id = ? FOR UPDATE`,
    [DOC_TYPES, userId],
  );
  if (!u || u.status !== 'ATIVO') return 'Sua conta não está liberada para candidaturas.';
  if (!u.terms_accepted_at) return 'Complete seu cadastro antes de se candidatar.';
  if (Number(u.docs_ok) < DOC_TYPES.length) return 'Seus documentos estão em análise; você poderá se candidatar assim que forem aprovados.';
  return null;
}

/** Já tem diária aprovada em aberto (não encerrada nem confirmada como concluída/falta) que cruza o horário desta vaga? */
export async function hasOverlap(tq, userId, job) {
  const [hit] = await tq(
    `SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id JOIN work_sessions ws ON ws.application_id = a.id
     LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
     WHERE a.user_id = ? AND a.status = 'APROVADA' AND dc.application_id IS NULL AND ws.status NOT IN ('FINALIZADA', 'CANCELADA_ADMINISTRATIVAMENTE')
       AND j.id <> ? AND j.starts_at < ? AND j.ends_at > ? LIMIT 1`,
    [userId, job.id, job.ends_at, job.starts_at],
  );
  return !!hit;
}

const approvedCount = async (tq, jobId) => Number((await tq("SELECT COUNT(*) AS n FROM applications WHERE job_id = ? AND status = 'APROVADA'", [jobId]))[0].n);

/** Aprova a candidatura (decided_by NULL = automático) e cria a jornada que libera o check-in. */
async function approve(c, appId, action) {
  await c.tq("UPDATE applications SET status = 'APROVADA', decided_by = NULL, decided_at = ? WHERE id = ?", [new Date(), appId]);
  await c.tq('INSERT INTO work_sessions (id, application_id) VALUES (?,?)', [randomUUID(), appId]);
  await audit(c.tq, c.req, action, 'application', appId, { before: { status: 'PENDENTE' }, after: { status: 'APROVADA' } });
}

/** Bloqueia a aprovação (automática, promoção ou do gestor) de quem não está habilitado ou tem conflito de horário. */
export async function assertCanApprove(tq, userId, job) {
  const reason = await notEligible(tq, userId);
  if (reason) fail(409, reason);
  if (await hasOverlap(tq, userId, job)) fail(409, 'Já existe uma diária aprovada nesse horário para este profissional.');
}

/** Candidatura: aprovada na hora se houver posição; senão entra na reserva. A vaga já deve estar travada (FOR UPDATE). */
export async function applyToJob(c, job, userId) {
  const reason = await notEligible(c.tq, userId);
  if (reason) fail(403, reason);
  if (await hasOverlap(c.tq, userId, job)) fail(409, 'Você já tem uma diária aprovada nesse horário.');
  const id = randomUUID();
  await c.tq('INSERT INTO applications (id, job_id, user_id) VALUES (?,?,?)', [id, job.id, userId]);
  await audit(c.tq, c.req, 'APPLICATION_CREATE', 'application', id);
  if (await approvedCount(c.tq, job.id) < job.positions) {
    await approve(c, id, 'APPLICATION_AUTO_APPROVE');
    return { id, status: 'APROVADA' };
  }
  return { id, status: 'RESERVA', position: await reservePosition(c.tq, job.id, id) };
}

/** Posição na reserva (1 = próximo a ser chamado), por ordem de chegada. */
export async function reservePosition(tq, jobId, appId) {
  const [r] = await tq(
    `SELECT COUNT(*) AS n FROM applications a, applications me
     WHERE me.id = ? AND a.job_id = ? AND a.status = 'PENDENTE' AND (a.created_at < me.created_at OR (a.created_at = me.created_at AND a.id <= me.id))`,
    [appId, jobId],
  );
  return Number(r.n);
}

/** Posição liberada: chama a reserva por ordem de chegada (pula quem não está mais habilitado ou ficou com conflito de horário). */
export async function promoteFromWaitlist(c, jobId) {
  const [job] = await c.tq(
    'SELECT j.id, j.title, j.status, j.positions, j.starts_at, j.ends_at, un.name AS unit_name, un.status AS unit_status FROM jobs j JOIN units un ON un.id = j.unit_id WHERE j.id = ? FOR UPDATE',
    [jobId],
  );
  // Mesmas condições da candidatura: vaga aberta, loja ativa, ainda não começou.
  if (!job || job.status !== 'ABERTA' || job.unit_status !== 'ATIVA' || new Date(job.starts_at) <= new Date()) return [];
  let free = job.positions - await approvedCount(c.tq, job.id);
  const promoted = [];
  if (free <= 0) return promoted;
  const reserve = await c.tq(
    "SELECT a.id, a.user_id, u.email, u.name, u.whatsapp FROM applications a JOIN users u ON u.id = a.user_id WHERE a.job_id = ? AND a.status = 'PENDENTE' ORDER BY a.created_at, a.id FOR UPDATE",
    [job.id],
  );
  for (const r of reserve) {
    if (free <= 0) break;
    if (await notEligible(c.tq, r.user_id) || await hasOverlap(c.tq, r.user_id, job)) continue;
    await approve(c, r.id, 'APPLICATION_PROMOTE');
    c.outbox.push([r.email, `UpService: você foi chamado(a) da reserva — ${job.unit_name}`,
      `Olá, ${r.name}.\n\nAbriu uma posição e sua candidatura para "${job.title}" em ${job.unit_name} (${fmt(job.starts_at)}) foi aprovada.\nNo dia, faça o check-in pelo app.`]);
    // Aviso dentro do app, na mesma transação (some junto se a operação for desfeita).
    await c.tq('INSERT INTO notifications SET ?', [{ id: randomUUID(), user_id: r.user_id, kind: 'RESERVA_CHAMADA', title: 'Você saiu da reserva!', body: `Abriu uma vaga e você está confirmado(a) em "${job.title}" — ${job.unit_name}, ${fmt(job.starts_at)}.`, link: '/minhas' }]);
    // WhatsApp confirmado: avisa na hora que saiu da reserva e já está aprovado.
    if (r.whatsapp) {
      c.whatsapp.push([r.whatsapp, `Olá, ${r.name.split(' ')[0]}! Boa notícia: abriu uma vaga e você saiu da reserva. ✅

Você está confirmado(a) em "${job.title}" — ${job.unit_name}, ${fmt(job.starts_at)}.

No dia, faça o check-in pelo app: ${APP_URL()}/minhas
Se não puder ir, desista aqui ou pelo app, para chamar o próximo da reserva.`, { userId: r.user_id, step: 'diaria', ctx: { appId: r.id } }]);
    }
    promoted.push(r.id);
    free -= 1;
  }
  return promoted;
}
