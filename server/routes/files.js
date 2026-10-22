// Única saída de documentos e selfies: sessão + escopo + auditoria. Sem URL pública.
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireLogin, unitAllowed, workerAllowed } from '../auth.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { loadFile } from '../storage.js';

const r = Router();

async function send(res, key, mime, cache = 'private, no-store') {
  // Selfies/documentos de conta excluída ficam sem chave e sem arquivo: 404, não erro interno.
  if (!key) fail(404, 'Arquivo removido.');
  const data = await loadFile(key).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
  if (!data) fail(404, 'Arquivo não encontrado.');
  res.set({ 'Content-Type': mime, 'Cache-Control': cache, 'Content-Disposition': 'inline' });
  res.send(data);
}

r.get('/files/doc/:id', requireLogin, async (req, res) => {
  const [doc] = await q('SELECT id, user_id, type, storage_key, mime FROM worker_documents WHERE id = ?', [req.params.id]);
  if (!doc || !(await workerAllowed(req.user, doc.user_id))) fail(404, 'Não encontrado.');
  // Foto de perfil nas listas (?avatar=1): só a selfie, sem auditoria e com cache curto, senão cada lista de 100
  // usuários viraria 100 registros de "documento visto". Abrir o documento continua auditado.
  if (req.query.avatar === '1' && doc.type === 'SELFIE') return send(res, doc.storage_key, doc.mime, 'private, max-age=3600');
  await audit(q, req, 'DOCUMENT_VIEW', 'worker_document', doc.id);
  await send(res, doc.storage_key, doc.mime);
});

r.get('/files/selfie/:eventId', requireLogin, async (req, res) => {
  const [ev] = await q(
    `SELECT e.id, e.selfie_key, a.user_id, j.unit_id FROM presence_events e
     JOIN work_sessions ws ON ws.id = e.work_session_id JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id
     WHERE e.id = ?`,
    [req.params.eventId],
  );
  if (!ev || (ev.user_id !== req.user.id && !(await unitAllowed(req.user, ev.unit_id)))) fail(404, 'Não encontrado.');
  await audit(q, req, 'SELFIE_VIEW', 'presence_event', ev.id);
  await send(res, ev.selfie_key, 'image/jpeg');
});

r.get('/files/exception/:id', requireLogin, async (req, res) => {
  const [exc] = await q(
    `SELECT x.id, x.selfie_key, a.user_id, j.unit_id FROM presence_exceptions x
     JOIN work_sessions ws ON ws.id = x.work_session_id JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id
     WHERE x.id = ?`,
    [req.params.id],
  );
  if (!exc || (exc.user_id !== req.user.id && !(await unitAllowed(req.user, exc.unit_id)))) fail(404, 'Não encontrado.');
  await audit(q, req, 'SELFIE_VIEW', 'presence_exception', exc.id);
  await send(res, exc.selfie_key, 'image/jpeg');
});

export default r;
