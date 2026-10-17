// Quebra de caixa: em diária de caixa, o gestor da loja (ou o admin) lança a diferença que faltou no caixa ao fim do
// expediente. O valor é ABATIDO do A receber, com o motivo. Não é ocorrência nem punição: não conta para bloqueio
// nem tira estrela. O profissional pode pedir UMA revisão (fluxo de contestação, decisão final).
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, requireReason, text } from '../http.js';
import { sendWhatsappSafe } from '../whatsapp.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const day = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

/** Avisa o profissional no app (na mesma transação) e, depois, pelo WhatsApp confirmado. */
export async function notifyBreak(tq, userId, title, body) {
  await tq('INSERT INTO notifications SET ?', [{ id: randomUUID(), user_id: userId, kind: 'QUEBRA_CAIXA', title, body, link: '/carteira' }]);
  const [u] = await tq('SELECT whatsapp, whatsapp_verified_at FROM users WHERE id = ?', [userId]);
  return u?.whatsapp_verified_at && u.whatsapp ? () => sendWhatsappSafe(u.whatsapp, `UP Service: ${title}. ${body}`) : null;
}

r.post('/manage/applications/:id/quebra-caixa', MANAGERS, async (req, res) => {
  const amount = Math.round(Number(String(req.body.amount ?? '').replace(',', '.')) * 100) / 100;
  const reason = text(req.body.reason, 'motivo', { min: 5, max: 500 });
  const [a] = await q(
    `SELECT a.id, a.user_id, a.status, j.unit_id, j.title, j.starts_at, j.daily_value, j.is_cashier, ws.status AS session_status, un.name AS unit_name
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id LEFT JOIN work_sessions ws ON ws.application_id = a.id
     WHERE a.id = ?`,
    [req.params.id],
  );
  if (!a) fail(404, 'Não encontrado.');
  await assertUnit(req.user, a.unit_id);
  if (!a.is_cashier) fail(409, 'Esta diária não é de caixa.');
  if (a.status !== 'APROVADA' || a.session_status !== 'FINALIZADA') fail(409, 'A quebra de caixa só pode ser lançada depois do fim da diária (checkout feito).');
  if (!(amount > 0)) fail(400, 'Informe o valor da quebra de caixa.');
  if (amount > Number(a.daily_value)) fail(400, `A quebra de caixa não pode passar do valor da diária (${brl(a.daily_value)}).`);
  const id = randomUUID();
  let send;
  try {
    send = await tx(async (tq) => {
      await tq('INSERT INTO cash_breaks SET ?', [{ id, application_id: a.id, user_id: a.user_id, unit_id: a.unit_id, amount, reason, created_by: req.user.id }]);
      await audit(tq, req, 'CASH_BREAK_SET', 'cash_break', id, { after: { applicationId: a.id, amount, reason } });
      return notifyBreak(tq, a.user_id, `Quebra de caixa registrada: ${brl(amount)}`,
        `Diária de ${day(a.starts_at)} (${a.title} · ${a.unit_name}). Motivo: ${reason}. Esse valor é abatido do seu A receber. Se não concordar, peça revisão na Carteira.`);
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') fail(409, 'Já existe quebra de caixa lançada nesta diária.');
    throw e;
  }
  if (send) setImmediate(send);
  res.status(201).json({ id });
});

r.post('/manage/quebras/:id/cancel', MANAGERS, async (req, res) => {
  const reason = requireReason(req.body.reason);
  const send = await tx(async (tq) => {
    const [cb] = await tq('SELECT * FROM cash_breaks WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!cb) fail(404, 'Não encontrado.');
    await assertUnit(req.user, cb.unit_id);
    if (cb.status !== 'ATIVA') fail(409, 'Esta quebra de caixa já foi cancelada.');
    await tq("UPDATE cash_breaks SET status = 'CANCELADA', canceled_by = ?, canceled_at = ?, cancel_reason = ? WHERE id = ?", [req.user.id, new Date(), reason, cb.id]);
    await audit(tq, req, 'CASH_BREAK_CANCEL', 'cash_break', cb.id, { before: { status: 'ATIVA' }, after: { status: 'CANCELADA' }, reason });
    return notifyBreak(tq, cb.user_id, `Quebra de caixa cancelada (${brl(cb.final_amount ?? cb.amount)})`, 'O valor volta para o seu A receber.');
  });
  if (send) setImmediate(send);
  res.json({ ok: true });
});

/** Quebras de caixa de um profissional (ficha do gestor e Carteira), com a revisão, se houver. */
export async function breaksOf(userId, unitFilter = null) {
  return q(
    `SELECT cb.id, cb.application_id, cb.unit_id, cb.amount, cb.final_amount, cb.reason, cb.status, cb.created_at, cb.cancel_reason,
            j.title, j.starts_at, un.name AS unit_name, dc.result AS diaria_result,
            c.id AS review_id, c.protocol AS review_protocol, c.status AS review_status, c.message AS review_message, c.decision_reason AS review_reason
     FROM cash_breaks cb JOIN applications a ON a.id = cb.application_id JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = cb.unit_id
     LEFT JOIN contestations c ON c.cash_break_id = cb.id LEFT JOIN daily_confirmations dc ON dc.application_id = cb.application_id
     WHERE cb.user_id = ? ${unitFilter ? 'AND cb.unit_id IN (?)' : ''} ORDER BY j.starts_at DESC`,
    unitFilter ? [userId, unitFilter] : [userId],
  );
}

r.get('/manage/workers/:id/quebras', MANAGERS, async (req, res) => {
  // Gestor vê as quebras das lojas dele; admin vê todas.
  if (req.user.role === 'ADMINISTRADOR') return res.json(await breaksOf(req.params.id));
  const units = (await q('SELECT unit_id FROM unit_managers WHERE user_id = ? AND active = 1', [req.user.id])).map((u) => u.unit_id);
  res.json(units.length ? await breaksOf(req.params.id, units) : []);
});

export default r;
