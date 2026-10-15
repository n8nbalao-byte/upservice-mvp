// Dados do próprio usuário logado: perfil, documentos, termos e resumo de diárias.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { publicUser, requireLogin, requireRole } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, text } from '../http.js';
import { isValidCpf } from '../rules.js';
import { decodeBase64, removeFile, saveFile, sniff } from '../storage.js';

const r = Router();
// SELFIE: foto do rosto tirada pela câmera no cadastro; base para a futura comparação facial.
export const DOC_TYPES = ['CPF', 'RG', 'COMPROVANTE', 'SELFIE'];
const MAX_DOC_BYTES = 5 * 1024 * 1024;

export async function profileState(userId) {
  const [profile] = await q('SELECT * FROM worker_profiles WHERE user_id = ?', [userId]);
  const documents = await q(
    "SELECT id, type, status, rejection_reason, mime, size, created_at FROM worker_documents WHERE user_id = ? AND status <> 'SUBSTITUIDO' ORDER BY created_at",
    [userId],
  );
  const docsOk = DOC_TYPES.every((t) => documents.some((d) => d.type === t && d.status !== 'REJEITADO'));
  return { profile: profile ?? null, documents, complete: !!profile?.terms_accepted_at && docsOk };
}

r.get('/me', requireLogin, async (req, res) => {
  const state = req.user.role === 'PROFISSIONAL' ? await profileState(req.user.id) : { profile: null, documents: [], complete: true };
  res.json({ user: publicUser(req.user), ...state });
});

const digits = (v) => String(v ?? '').replace(/\D/g, '');

r.put('/me/profile', requireRole('PROFISSIONAL'), async (req, res) => {
  const b = req.body;
  const cpf = digits(b.cpf);
  if (!isValidCpf(cpf)) fail(400, 'CPF inválido.');
  const phone = digits(b.phone);
  const emergencyPhone = digits(b.emergencyPhone);
  if (!/^\d{10,11}$/.test(phone)) fail(400, 'Telefone inválido (DDD + número).');
  if (!/^\d{10,11}$/.test(emergencyPhone)) fail(400, 'Telefone de emergência inválido (DDD + número).');
  const uf = String(b.uf ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) fail(400, 'UF inválida.');
  const v = {
    name: text(b.name, 'nome completo', { min: 3 }),
    rg: text(b.rg, 'RG', { min: 4, max: 20 }),
    address: text(b.address, 'endereço', { min: 5, max: 300 }),
    city: text(b.city, 'cidade', { max: 100 }),
    emergencyName: text(b.emergencyName, 'contato de emergência'),
  };

  const [current] = await q('SELECT cpf FROM worker_profiles WHERE user_id = ?', [req.user.id]);
  if (current && current.cpf !== cpf) fail(400, 'O CPF não pode ser alterado. Fale com a UpService.');
  try {
    await tx(async (tq) => {
      // Sem ON DUPLICATE KEY UPDATE: ele também dispararia na chave única do CPF e sobrescreveria o perfil de outra pessoa.
      const fields = { rg: v.rg, phone, address: v.address, city: v.city, uf, emergency_name: v.emergencyName, emergency_phone: emergencyPhone };
      if (current) await tq('UPDATE worker_profiles SET ? WHERE user_id = ?', [fields, req.user.id]);
      else await tq('INSERT INTO worker_profiles SET ?', [{ user_id: req.user.id, cpf, ...fields }]);
      await tq('UPDATE users SET name = ? WHERE id = ?', [v.name, req.user.id]);
      await audit(tq, req, 'PROFILE_SAVE', 'worker_profile', req.user.id);
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') fail(409, 'Este CPF já está cadastrado em outra conta. Fale com a UpService.');
    throw e;
  }
  res.json(await profileState(req.user.id));
});

r.post('/me/documents', requireRole('PROFISSIONAL'), async (req, res) => {
  const type = req.body.type;
  if (!DOC_TYPES.includes(type)) fail(400, 'Tipo de documento inválido.');
  const buf = decodeBase64(req.body.file);
  if (!buf.length) fail(400, 'Arquivo vazio.');
  if (buf.length > MAX_DOC_BYTES) fail(413, 'Arquivo maior que 5 MB.');
  const mime = sniff(buf);
  if (!mime) fail(400, 'Formato aceito: JPG, PNG ou PDF.');
  if (type === 'SELFIE' && mime === 'application/pdf') fail(400, 'A selfie deve ser uma foto do seu rosto.');

  const [current] = await q("SELECT id, status FROM worker_documents WHERE user_id = ? AND type = ? AND status <> 'SUBSTITUIDO'", [req.user.id, type]);
  if (current?.status === 'APROVADO') fail(409, 'Documento já aprovado. Fale com a UpService para substituí-lo.');

  const saved = await saveFile(`docs/${req.user.id}`, buf, mime);
  try {
    await tx(async (tq) => {
      if (current) await tq("UPDATE worker_documents SET status = 'SUBSTITUIDO' WHERE id = ?", [current.id]);
      const id = randomUUID();
      await tq('INSERT INTO worker_documents (id, user_id, type, storage_key, sha256, size, mime) VALUES (?,?,?,?,?,?,?)', [
        id, req.user.id, type, saved.key, saved.sha256, buf.length, mime,
      ]);
      await audit(tq, req, 'DOCUMENT_UPLOAD', 'worker_document', id, { after: { type, replaced: current?.id ?? null } });
    });
  } catch (e) {
    await removeFile(saved.key);
    throw e;
  }
  res.json(await profileState(req.user.id));
});

r.post('/me/terms', requireRole('PROFISSIONAL'), async (req, res) => {
  if (req.body.accept !== true) fail(400, 'É preciso aceitar os termos.');
  const result = await q('UPDATE worker_profiles SET terms_accepted_at = ? WHERE user_id = ? AND terms_accepted_at IS NULL', [new Date(), req.user.id]);
  const [exists] = await q('SELECT 1 FROM worker_profiles WHERE user_id = ?', [req.user.id]);
  if (!exists) fail(400, 'Preencha seus dados antes de aceitar os termos.');
  if (result.affectedRows) await audit(q, req, 'TERMS_ACCEPT', 'worker_profile', req.user.id);
  res.json(await profileState(req.user.id));
});

// O profissional vê só quantidades e o valor a receber (pauta da reunião).
r.get('/me/summary', requireRole('PROFISSIONAL'), async (req, res) => {
  const [s] = await q(
    `SELECT COUNT(*) AS candidaturas,
            COALESCE(SUM(a.status = 'APROVADA'), 0) AS aprovadas,
            COALESCE(SUM(ws.status = 'FINALIZADA'), 0) AS comparecidas,
            COALESCE(SUM(dc.result = 'CONCLUIDA'), 0) AS concluidas,
            COALESCE(SUM(CASE WHEN dc.result = 'CONCLUIDA' THEN j.daily_value END), 0) AS valor
     FROM applications a JOIN jobs j ON j.id = a.job_id
     LEFT JOIN work_sessions ws ON ws.application_id = a.id
     LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
     WHERE a.user_id = ?`,
    [req.user.id],
  );
  res.json(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])));
});

export default r;
