// Carteira do profissional: o que ele tem a receber (diárias concluídas + bônus ganhos − pagamentos), a chave Pix
// e os pagamentos com o comprovante do banco. O gestor paga pelo QR Code do Pix no app do banco, anexa o comprovante
// e marca como pago; o mesmo comprovante vai pelo WhatsApp e fica na Carteira.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireRole, workerAllowed } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, text } from '../http.js';
import { PIX_TYPES, brCode, normalizePixKey } from '../pix.js';
import { decodeBase64, loadFile, removeFile, saveFile, sniff } from '../storage.js';
import { sendWhatsappMediaSafe } from '../whatsapp.js';
import { earnedBonuses } from './estrelas.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const cents = (v) => Math.round(Number(v) * 100);
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');

/** Saldo e composição. Única conta do "A receber" (profissional, gestor e resumo usam esta). Valores em centavos por dentro. */
export async function wallet(userId, tq = q) {
  const diarias = await tq(
    `SELECT a.id, j.title, j.starts_at, j.daily_value AS value, u.name AS unit
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units u ON u.id = j.unit_id
     JOIN daily_confirmations dc ON dc.application_id = a.id AND dc.result = 'CONCLUIDA'
     WHERE a.user_id = ? ORDER BY j.starts_at DESC`,
    [userId],
  );
  const bonus = await earnedBonuses(userId);
  const pagamentos = await tq('SELECT id, amount, paid_at, receipt_mime, note FROM worker_payments WHERE user_id = ? ORDER BY paid_at DESC', [userId]);
  const sum = (rows) => rows.reduce((t, x) => t + cents(x.amount ?? x.value), 0);
  const d = sum(diarias);
  const b = sum(bonus);
  const p = sum(pagamentos);
  return {
    aReceber: (d + b - p) / 100, diarias: d / 100, bonus: b / 100, pago: p / 100,
    itens: [
      ...diarias.map((x) => ({ kind: 'DIARIA', id: x.id, date: new Date(x.starts_at).toISOString(), text: `${x.title} · ${x.unit}`, value: Number(x.value) })),
      ...bonus.map((x) => ({ kind: 'BONUS', id: `bonus-${x.day}`, date: `${x.day}T15:00:00.000Z`, text: `Bônus do dia ${x.day.slice(8, 10)}/${x.day.slice(5, 7)} (3 estrelas)`, value: x.value })),
    ].sort((a, b2) => b2.date.localeCompare(a.date)),
    pagamentos: pagamentos.map((x) => ({ id: x.id, amount: Number(x.amount), paidAt: x.paid_at, receipt: !!x.receipt_mime, receiptMime: x.receipt_mime, note: x.note })),
  };
}

r.put('/me/pix', requireRole('PROFISSIONAL'), async (req, res) => {
  const type = String(req.body.type ?? '');
  if (!PIX_TYPES.includes(type)) fail(400, 'Escolha o tipo da chave Pix.');
  const key = normalizePixKey(type, req.body.key);
  if (!key) fail(400, { CPF: 'CPF inválido.', EMAIL: 'E-mail inválido.', TELEFONE: 'Celular inválido (DDD + número).', ALEATORIA: 'Chave aleatória inválida (formato 0000…-0000).' }[type]);
  const [p] = await q('SELECT pix_type, pix_key FROM worker_profiles WHERE user_id = ?', [req.user.id]);
  if (!p) fail(400, 'Preencha seus dados no Cadastro antes da chave Pix.');
  await q('UPDATE worker_profiles SET pix_type = ?, pix_key = ? WHERE user_id = ?', [type, key, req.user.id]);
  // Auditoria sem a chave em si (dado pessoal): só o tipo e se mudou.
  await audit(q, req, 'PIX_KEY_SET', 'worker_profile', req.user.id, { before: { type: p.pix_type ?? null }, after: { type, changed: p.pix_key !== key } });
  res.json({ pixType: type, pixKey: key });
});

r.get('/me/carteira', requireRole('PROFISSIONAL'), async (req, res) => {
  const [p] = await q('SELECT pix_type, pix_key FROM worker_profiles WHERE user_id = ?', [req.user.id]);
  res.json({ pixType: p?.pix_type ?? null, pixKey: p?.pix_key ?? null, ...(await wallet(req.user.id)) });
});

async function workerFor(req) {
  if (!(await workerAllowed(req.user, req.params.id))) fail(404, 'Profissional não encontrado.');
  const [w] = await q(
    `SELECT u.id, u.name, u.whatsapp, p.phone, p.city, p.pix_type, p.pix_key FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id
     WHERE u.id = ? AND u.role = 'PROFISSIONAL' AND u.deleted_at IS NULL`,
    [req.params.id],
  );
  if (!w) fail(404, 'Profissional não encontrado.');
  return w;
}

r.get('/manage/workers/:id/pagamento', MANAGERS, async (req, res) => {
  const w = await workerFor(req);
  const wl = await wallet(w.id);
  // Código Pix com o valor em aberto (o gestor pode pagar outro valor digitando no app do banco).
  const payload = w.pix_key && wl.aReceber > 0 ? brCode({ key: w.pix_key, amount: wl.aReceber, name: w.name, city: w.city }) : null;
  await audit(q, req, 'PAYMENT_VIEW', 'user', w.id);
  res.json({ name: w.name, pixType: w.pix_type, pixKey: w.pix_key, payload, ...wl });
});

r.post('/manage/workers/:id/pagamentos', MANAGERS, async (req, res) => {
  const w = await workerFor(req);
  const amount = Number(String(req.body.amount ?? '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) fail(400, 'Informe o valor pago.');
  if (!w.pix_key) fail(409, 'O profissional ainda não cadastrou a chave Pix.');
  const buf = decodeBase64(req.body.receipt);
  if (!buf.length) fail(400, 'Anexe o comprovante do banco (foto ou PDF).');
  if (buf.length > MAX_RECEIPT_BYTES) fail(413, 'Comprovante maior que 5 MB.');
  const mime = sniff(buf);
  if (!mime) fail(400, 'Comprovante: formato aceito JPG, PNG ou PDF.');
  const note = text(req.body.note, 'observação', { max: 300, optional: true });

  const saved = await saveFile(`comprovantes/${w.id}`, buf, mime);
  const id = randomUUID();
  try {
    await tx(async (tq) => {
      // Trava o profissional para dois gestores não pagarem o mesmo saldo ao mesmo tempo.
      await tq('SELECT id FROM users WHERE id = ? FOR UPDATE', [w.id]);
      const { aReceber } = await wallet(w.id, tq);
      if (cents(amount) > cents(aReceber)) fail(400, `O valor pago passa do que ele tem a receber (${brl(aReceber)}).`);
      await tq('INSERT INTO worker_payments SET ?', [{ id, user_id: w.id, amount, pix_key: w.pix_key, receipt_key: saved.key, receipt_mime: mime, paid_by: req.user.id, note }]);
      await tq('INSERT INTO notifications SET ?', [{ id: randomUUID(), user_id: w.id, kind: 'PAGAMENTO', title: `Pagamento recebido: ${brl(amount)}`, body: 'O comprovante está na sua Carteira.', link: '/carteira' }]);
      await audit(tq, req, 'PAYMENT', 'worker_payment', id, { after: { userId: w.id, amount, receiptSha256: saved.sha256 } });
    });
  } catch (e) {
    await removeFile(saved.key);
    throw e;
  }
  // O mesmo comprovante vai pelo WhatsApp (em segundo plano; falha não desfaz o pagamento).
  const phone = w.whatsapp || w.phone;
  if (phone) {
    setImmediate(() => sendWhatsappMediaSafe(phone, {
      buf, mime, fileName: `comprovante-upservice.${mime === 'application/pdf' ? 'pdf' : mime.split('/')[1]}`,
      caption: `UP Service: pagamento de ${brl(amount)} feito na sua chave Pix. Este é o comprovante. Ele também fica na sua Carteira: ${APP_URL()}/carteira`,
    }));
  }
  res.json({ ok: true, id, ...(await wallet(w.id)) });
});

// Comprovante: só o próprio profissional ou o gestor/admin que acompanha ele.
r.get('/files/comprovante/:id', requireRole('PROFISSIONAL', 'GESTOR', 'ADMINISTRADOR'), async (req, res) => {
  const [p] = await q('SELECT id, user_id, receipt_key, receipt_mime FROM worker_payments WHERE id = ?', [req.params.id]);
  if (!p || !(await workerAllowed(req.user, p.user_id))) fail(404, 'Não encontrado.');
  if (!p.receipt_key) fail(404, 'Comprovante removido.');
  const data = await loadFile(p.receipt_key).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
  if (!data) fail(404, 'Arquivo não encontrado.');
  await audit(q, req, 'RECEIPT_VIEW', 'worker_payment', p.id);
  res.set({ 'Content-Type': p.receipt_mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
  res.send(data);
});

export default r;
