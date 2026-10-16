// Avisos do profissional dentro do app e a contagem de diárias que vêm pela frente (número no botão "Diárias").
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { q } from '../db.js';

const r = Router();

r.get('/me/avisos', requireRole('PROFISSIONAL'), async (req, res) => {
  const [items, [{ unread }], [{ upcoming }]] = await Promise.all([
    q('SELECT id, kind, title, body, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [req.user.id]),
    q('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id]),
    q(`SELECT COUNT(*) AS upcoming FROM applications a JOIN jobs j ON j.id = a.job_id JOIN work_sessions ws ON ws.application_id = a.id
       WHERE a.user_id = ? AND a.status = 'APROVADA' AND j.ends_at > ? AND ws.status IN ('AGUARDANDO_CHECKIN', 'EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA')`, [req.user.id, new Date()]),
  ]);
  res.json({ items, unread: Number(unread), upcoming: Number(upcoming) });
});

// Marca como lidos: os ids informados ou, sem ids, todos.
r.post('/me/avisos/lidos', requireRole('PROFISSIONAL'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).slice(0, 100) : null;
  if (ids?.length) await q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (?)', [new Date(), req.user.id, ids]);
  else await q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [new Date(), req.user.id]);
  res.json({ ok: true });
});

export default r;
