// Tela de estrelas do profissional (prévia). O profissional só vê com "Estrelas" ligado em Configurações; gestor e
// administrador veem a de qualquer profissional que acompanham, ligado ou não (para conferir antes de abrir para todos).
import { Router } from 'express';
import { requireRole, workerAllowed } from '../auth.js';
import { q } from '../db.js';
import { buildMonth, diaryStars, levelOf } from '../estrelas.js';
import { fail } from '../http.js';

const r = Router();
const monthOf = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
export const gamificationOn = async () => (await q("SELECT value FROM app_settings WHERE name = 'gamification'"))[0]?.value === 'on';

async function starsOf(userId) {
  const rows = await q(
    `SELECT a.id, j.title, j.starts_at, j.ends_at, u.name AS unit_name, ws.status AS session_status, dc.result,
            (SELECT GROUP_CONCAT(DISTINCT e.validation) FROM presence_events e WHERE e.work_session_id = ws.id) AS validations,
            (SELECT GROUP_CONCAT(o.type) FROM occurrences o WHERE o.application_id = a.id AND o.status <> 'CANCELADA') AS occurrences
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units u ON u.id = j.unit_id
     LEFT JOIN work_sessions ws ON ws.application_id = a.id LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
     WHERE a.user_id = ? AND a.status = 'APROVADA' AND (ws.status IS NULL OR ws.status <> 'CANCELADA_ADMINISTRATIVAMENTE')
     ORDER BY j.starts_at`,
    [userId],
  );
  const now = Date.now();
  const byMonth = new Map([[monthOf(now), []]]);
  for (const row of rows) {
    const s = diaryStars({
      result: row.result, sessionStatus: row.session_status, endsAt: row.ends_at,
      validations: (row.validations ?? '').split(',').filter(Boolean), occurrences: (row.occurrences ?? '').split(',').filter(Boolean),
    }, now);
    const m = monthOf(row.starts_at);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push({ id: row.id, title: row.title, unit: row.unit_name, startsAt: row.starts_at, ...s });
  }
  const months = [...byMonth.keys()].sort().map((m) => buildMonth(m, byMonth.get(m)));
  const total = months.reduce((t, m) => t + m.stars, 0);
  return { current: monthOf(now), total, ...levelOf(total), months };
}

r.get('/me/estrelas', requireRole('PROFISSIONAL'), async (req, res) => {
  if (!(await gamificationOn())) fail(403, 'As estrelas ainda não estão disponíveis.');
  res.json(await starsOf(req.user.id));
});

r.get('/manage/workers/:id/estrelas', requireRole('GESTOR', 'ADMINISTRADOR'), async (req, res) => {
  if (!(await workerAllowed(req.user, req.params.id))) fail(404, 'Profissional não encontrado.');
  const [u] = await q("SELECT name FROM users WHERE id = ? AND role = 'PROFISSIONAL'", [req.params.id]);
  if (!u) fail(404, 'Profissional não encontrado.');
  res.json({ name: u.name, ...(await starsOf(req.params.id)) });
});

export default r;
