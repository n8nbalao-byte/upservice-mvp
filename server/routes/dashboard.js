// Painel inicial do gestor/admin e busca do topo. Só leitura, sempre no escopo de unidades do usuário.
import { Router } from 'express';
import { requireRole, unitScope, workerScope } from '../auth.js';
import { q } from '../db.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');

r.get('/manage/dashboard', MANAGERS, async (req, res) => {
  const [uWhere, uArgs] = unitScope(req.user, 'j.unit_id');
  const [wWhere, wArgs] = workerScope(req.user, 'd.id');
  const [dWhere, dArgs] = workerScope(req.user, 'd.user_id');
  const now = new Date();
  // ponytail: dia operacional em UTC-3, igual a /manage/sessions.
  const dayStart = new Date(`${now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}T00:00:00-03:00`);
  const today = [dayStart, new Date(dayStart.getTime() + 86400e3), ...uArgs];
  const [[workers], [jobs], [docs], sessions, [exceptions], latest] = await Promise.all([
    q(`SELECT COUNT(*) AS n FROM users d WHERE d.role = 'PROFISSIONAL' AND d.status = 'ATIVO' AND ${wWhere}`, wArgs),
    q(`SELECT COUNT(*) AS n, COALESCE(SUM(j.positions), 0) AS positions,
              COALESCE(SUM((SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'APROVADA')), 0) AS filled
       FROM jobs j WHERE j.status = 'ABERTA' AND j.ends_at > ? AND ${uWhere}`, [now, ...uArgs]),
    q(`SELECT COUNT(*) AS n, COUNT(DISTINCT d.user_id) AS people FROM worker_documents d WHERE d.status = 'PENDENTE' AND ${dWhere}`, dArgs),
    q(`SELECT ws.status, COUNT(*) AS n FROM work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id
       WHERE j.starts_at >= ? AND j.starts_at < ? AND ${uWhere} GROUP BY ws.status`, today),
    q(`SELECT COUNT(*) AS n FROM presence_exceptions x JOIN work_sessions ws ON ws.id = x.work_session_id
       JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id
       WHERE x.status = 'PENDENTE' AND j.starts_at >= ? AND j.starts_at < ? AND ${uWhere}`, today),
    q(`SELECT j.id, j.title, j.starts_at, j.ends_at, j.daily_value, j.positions, j.status, un.name AS unit_name,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status <> 'CANCELADA') AS applications,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'APROVADA') AS approved
       FROM jobs j JOIN units un ON un.id = j.unit_id WHERE ${uWhere} ORDER BY j.created_at DESC LIMIT 6`, uArgs),
  ]);
  res.json({
    serverNow: now,
    workers: Number(workers.n),
    openJobs: { jobs: Number(jobs.n), positions: Number(jobs.positions), filled: Number(jobs.filled) },
    pendingDocuments: { documents: Number(docs.n), people: Number(docs.people) },
    today: { ...Object.fromEntries(sessions.map((x) => [x.status, Number(x.n)])), exceptions: Number(exceptions.n) },
    latestJobs: latest,
  });
});

r.get('/manage/search', MANAGERS, async (req, res) => {
  const term = String(req.query.q ?? '').trim().slice(0, 60);
  if (term.length < 2) return res.json({ workers: [], jobs: [], units: [] });
  const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const [wWhere, wArgs] = workerScope(req.user, 'd.id');
  const [jWhere, jArgs] = unitScope(req.user, 'j.unit_id');
  const [uWhere, uArgs] = unitScope(req.user, 'un.id');
  const [workers, jobs, units] = await Promise.all([
    q(`SELECT d.id, d.name, d.status FROM users d WHERE d.role = 'PROFISSIONAL' AND d.name LIKE ? AND ${wWhere} ORDER BY d.name LIMIT 5`, [like, ...wArgs]),
    q(`SELECT j.id, j.title, j.starts_at, j.status, un.name AS unit_name FROM jobs j JOIN units un ON un.id = j.unit_id
       WHERE j.title LIKE ? AND ${jWhere} ORDER BY j.starts_at DESC LIMIT 5`, [like, ...jArgs]),
    q(`SELECT un.id, un.code, un.name FROM units un WHERE (un.name LIKE ? OR un.code LIKE ?) AND ${uWhere} ORDER BY un.code LIMIT 5`, [like, like, ...uArgs]),
  ]);
  res.json({ workers, jobs, units });
});

export default r;
