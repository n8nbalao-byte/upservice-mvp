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
import { sendTemplateSafe } from '../whatsapp.js';
import { bonusGanhoPorUsuario, earnedBonuses } from './estrelas.js';
import { breaksOf } from './quebra.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const cents = (v) => Math.round(Number(v) * 100);
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
  const quebras = await breaksOf(userId);
  const sum = (rows) => rows.reduce((t, x) => t + cents(x.amount ?? x.value), 0);
  const d = sum(diarias);
  const b = sum(bonus);
  const p = sum(pagamentos);
  // Quebra de caixa: abate o valor final (depois da revisão) só quando a diária já entrou como concluída.
  const counts = (x) => x.status === 'ATIVA' && x.diaria_result === 'CONCLUIDA';
  const qb = quebras.filter(counts).reduce((t, x) => t + cents(x.final_amount ?? x.amount), 0);
  return {
    aReceber: (d + b - qb - p) / 100, diarias: d / 100, bonus: b / 100, quebras: qb / 100, pago: p / 100,
    abatimentos: quebras.map((x) => ({
      id: x.id, date: new Date(x.starts_at).toISOString(), text: `${x.title} · ${x.unit_name}`, reason: x.reason,
      amount: Number(x.amount), finalAmount: x.final_amount == null ? null : Number(x.final_amount), status: x.status, counts: counts(x), cancelReason: x.cancel_reason,
      review: x.review_id ? { protocol: x.review_protocol, status: x.review_status, reason: x.review_reason } : null,
    })),
    itens: [
      ...diarias.map((x) => ({ kind: 'DIARIA', id: x.id, date: new Date(x.starts_at).toISOString(), text: `${x.title} · ${x.unit}`, value: Number(x.value) })),
      ...bonus.map((x) => ({ kind: 'BONUS', id: `bonus-${x.day}`, date: `${x.day}T15:00:00.000Z`, text: `Bônus do dia ${x.day.slice(8, 10)}/${x.day.slice(5, 7)} (3 estrelas)`, value: x.value })),
    ].sort((a, b2) => b2.date.localeCompare(a.date)),
    pagamentos: pagamentos.map((x) => ({ id: x.id, amount: Number(x.amount), paidAt: x.paid_at, receipt: !!x.receipt_mime, receiptMime: x.receipt_mime, note: x.note })),
  };
}

/** Todos os profissionais com valor a receber (mesma conta de wallet, agregada no banco para não somar um a um). */
// ponytail: cópia de 30 s (o menu de cada admin consulta a cada minuto); limpa ao registrar pagamento. Guardar o saldo se crescer.
let copia = { at: 0, items: null };
export const limparPendentes = () => { copia = { at: 0, items: null }; };
export async function pendentes() {
  if (copia.items && Date.now() - copia.at < 30000) return copia.items;
  const items = await calcularPendentes();
  copia = { at: Date.now(), items };
  return items;
}

async function calcularPendentes() {
  const [diarias, pagos, quebras, bonus] = await Promise.all([
    q(`SELECT a.user_id, SUM(j.daily_value) AS v, COUNT(*) AS n, MIN(j.starts_at) AS desde
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN daily_confirmations dc ON dc.application_id = a.id AND dc.result = 'CONCLUIDA'
       GROUP BY a.user_id`),
    q('SELECT user_id, SUM(amount) AS v, MAX(paid_at) AS ultimo FROM worker_payments GROUP BY user_id'),
    q(`SELECT cb.user_id, SUM(COALESCE(cb.final_amount, cb.amount)) AS v FROM cash_breaks cb
       JOIN daily_confirmations dc ON dc.application_id = cb.application_id AND dc.result = 'CONCLUIDA'
       WHERE cb.status = 'ATIVA' GROUP BY cb.user_id`),
    bonusGanhoPorUsuario(),
  ]);
  const conta = new Map();
  const de = (id) => { if (!conta.has(id)) conta.set(id, { d: 0, b: 0, q: 0, p: 0, n: 0, desde: null, ultimo: null }); return conta.get(id); };
  for (const x of diarias) Object.assign(de(x.user_id), { d: cents(x.v), n: Number(x.n), desde: x.desde });
  for (const x of pagos) Object.assign(de(x.user_id), { p: cents(x.v), ultimo: x.ultimo });
  for (const x of quebras) de(x.user_id).q = cents(x.v);
  for (const [id, v] of bonus) de(id).b = cents(v);
  const abertos = [...conta].filter(([, c]) => c.d + c.b - c.q - c.p > 0);
  if (!abertos.length) return [];
  const pessoas = await q(
    `SELECT u.id, u.name, u.status, p.pix_type, p.pix_key FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id
     WHERE u.id IN (?) AND u.role = 'PROFISSIONAL' AND u.deleted_at IS NULL`,
    [abertos.map(([id]) => id)],
  );
  const por = new Map(pessoas.map((u) => [u.id, u]));
  return abertos.filter(([id]) => por.has(id)).map(([id, c]) => {
    const u = por.get(id);
    return {
      id, name: u.name, status: u.status, pixType: u.pix_type, pixKey: u.pix_key,
      aReceber: (c.d + c.b - c.q - c.p) / 100, diarias: c.d / 100, bonus: c.b / 100, quebras: c.q / 100, pago: c.p / 100,
      diariasConcluidas: c.n, desde: c.desde, ultimoPagamento: c.ultimo,
    };
  }).sort((a, b) => b.aReceber - a.aReceber || a.name.localeCompare(b.name));
}

// Pagamentos (administrador): quem tem valor a receber, para pagar sem entrar na ficha de cada um.
r.get('/admin/pagamentos', requireRole('ADMINISTRADOR'), async (req, res) => {
  const items = await pendentes();
  const total = items.reduce((t, x) => t + cents(x.aReceber), 0) / 100;
  if (req.query.resumo) return res.json({ count: items.length, total });
  await audit(q, req, 'PAYMENTS_LIST', 'worker_payment', null, { after: { count: items.length } });
  res.json({ count: items.length, total, items });
});

r.put('/me/pix', requireRole('PROFISSIONAL'), async (req, res) => {
  const type = String(req.body.type ?? '');
  if (!PIX_TYPES.includes(type)) fail(400, 'Escolha o tipo da chave Pix.');
  const key = normalizePixKey(type, req.body.key);
  if (!key) fail(400, { CPF: 'CPF inválido.', EMAIL: 'E-mail inválido.', TELEFONE: 'Celular inválido (DDD + número).', ALEATORIA: 'Chave aleatória inválida (formato 0000…-0000).' }[type]);
  const [p] = await q('SELECT pix_type, pix_key FROM worker_profiles WHERE user_id = ?', [req.user.id]);
  if (!p) fail(400, 'Preencha seus dados no Cadastro antes da chave Pix.');
  if (p.pix_key === key) return res.json({ pixType: type, pixKey: key });
  const changed = !!p.pix_key;
  await tx(async (tq) => {
    await tq('UPDATE worker_profiles SET pix_type = ?, pix_key = ? WHERE user_id = ?', [type, key, req.user.id]);
    // Auditoria sem a chave em si (dado pessoal): só o tipo. A troca (não o primeiro cadastro) fica marcada para o gestor.
    await audit(tq, req, changed ? 'PIX_KEY_CHANGE' : 'PIX_KEY_SET', 'worker_profile', req.user.id, { before: { type: p.pix_type ?? null }, after: { type } });
    if (changed) await tq('INSERT INTO notifications SET ?', [{ id: randomUUID(), user_id: req.user.id, kind: 'PIX_TROCADO', title: 'Sua chave Pix foi trocada', body: 'Se não foi você, fale com a UP Service agora.', link: '/carteira' }]);
  });
  // Troca de chave avisa pelo WhatsApp: quem invadir a conta não desvia o pagamento sem o dono saber.
  if (changed && req.user.whatsapp_verified_at && req.user.whatsapp) {
    setImmediate(() => sendTemplateSafe(req.user.whatsapp, 'pix_trocado'));
  }
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
  // Troca recente de chave: o gestor confirma com o profissional antes de pagar (proteção contra conta invadida).
  const [chg] = await q("SELECT created_at FROM audit_events WHERE action = 'PIX_KEY_CHANGE' AND entity = 'worker_profile' AND entity_id = ? ORDER BY created_at DESC LIMIT 1", [w.id]);
  await audit(q, req, 'PAYMENT_VIEW', 'user', w.id);
  res.json({ name: w.name, pixType: w.pix_type, pixKey: w.pix_key, pixChangedAt: chg?.created_at ?? null, payload, ...wl });
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
  limparPendentes(); // a lista de pagamentos do admin já reflete o pagamento
  // Aviso pelo WhatsApp (em segundo plano; falha não desfaz o pagamento). O comprovante fica na Carteira do app; pelo
  // atendimento, a pessoa também recebe o arquivo.
  const phone = w.whatsapp || w.phone;
  if (phone) setImmediate(() => sendTemplateSafe(phone, 'pagamento_feito', { vars: [brl(amount)] }));
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
