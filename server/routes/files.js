// Única saída de documentos e selfies: sessão + escopo + auditoria. Sem URL pública.
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireLogin, unitAllowed, workerAllowed } from '../auth.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { loadFile } from '../storage.js';

const r = Router();

async function send(res, key, mime) {
  res.set({ 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
  res.send(await loadFile(key));
}

r.get('/files/doc/:id', requireLogin, async (req, res) => {
  const [doc] = await q('SELECT id, user_id, storage_key, mime FROM worker_documents WHERE id = ?', [req.params.id]);
  if (!doc || !(await workerAllowed(req.user, doc.user_id))) fail(404, 'Não encontrado.');
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

export default r;
