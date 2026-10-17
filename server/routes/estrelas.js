// Estrelas do profissional: cada nível é um mês do ano, cada fase um dia. O profissional só vê com "Estrelas" ligado em
// Configurações; gestor e administrador veem a de qualquer profissional que acompanham. O bônus do mês (valor total)
// é definido pela gestão em "Bônus do mês"; o sistema sorteia os dias e divide o valor.
import { Router } from 'express';
import { requireRole, workerAllowed } from '../auth.js';
import { audit } from '../audit.js';
import { q, tx } from '../db.js';
import { buildMonth, diaryReport, diaryStars, planBonuses, sorteioStatus } from '../estrelas.js';
import { fail } from '../http.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
// Bônus do mês (valor em dinheiro): só o administrador define e vê.
const ADMIN = requireRole('ADMINISTRADOR');
const dateOf = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const todayKey = () => dateOf(Date.now());
export const gamificationOn = async () => (await q("SELECT value FROM app_settings WHERE name = 'gamification'"))[0]?.value === 'on';

/** Diárias aprovadas com as estrelas calculadas. `where` filtra (ex.: por profissional ou por período). */
async function diaries(where, params) {
  const rows = await q(
    `SELECT a.id, a.user_id, j.title, j.starts_at, j.ends_at, u.name AS unit_name, ws.status AS session_status, dc.result,
            (SELECT GROUP_CONCAT(DISTINCT e.validation) FROM presence_events e WHERE e.work_session_id = ws.id) AS validations,
            (SELECT GROUP_CONCAT(CONCAT(e.type, ':', e.validation) ORDER BY e.occurred_at) FROM presence_events e WHERE e.work_session_id = ws.id) AS steps,
            (SELECT GROUP_CONCAT(o.type) FROM occurrences o WHERE o.application_id = a.id AND o.status <> 'CANCELADA') AS occurrences
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units u ON u.id = j.unit_id
     LEFT JOIN work_sessions ws ON ws.application_id = a.id LEFT JOIN daily_confirmations dc ON dc.application_id = a.id
     WHERE a.status = 'APROVADA' AND (ws.status IS NULL OR ws.status <> 'CANCELADA_ADMINISTRATIVAMENTE') AND ${where}
     ORDER BY j.starts_at`,
    params,
  );
  const now = Date.now();
  return rows.map((row) => {
    const occurrences = (row.occurrences ?? '').split(',').filter(Boolean);
    const s = diaryStars({ result: row.result, sessionStatus: row.session_status, endsAt: row.ends_at, validations: (row.validations ?? '').split(',').filter(Boolean), occurrences }, now);
    // Primeiro registro de cada tipo (sem horário): base do resumo que o profissional vê ao tocar no dia.
    const steps = {};
    for (const p of (row.steps ?? '').split(',').filter(Boolean)) { const [t, v] = p.split(':'); steps[t] ??= v; }
    if (s.state === 'feita') s.report = diaryReport({ stars: s.stars, steps, occurrences });
    const date = dateOf(row.starts_at);
    return { id: row.id, userId: row.user_id, title: row.title, unit: row.unit_name, startsAt: row.starts_at, date, day: Number(date.slice(8, 10)), ...s };
  });
}

const bonusDaysOf = (from, to) => q("SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, kind, value, label FROM bonus_days WHERE day BETWEEN ? AND ? ORDER BY day", [from, to]);

/** Bônus ganhos (dia de bônus que já chegou + diária daquele dia com 3 estrelas), de todos os tempos. Um por dia. */
export async function earnedBonuses(userId) {
  const today = todayKey();
  const bonus = await q("SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, value FROM bonus_days WHERE kind = 'BONUS' AND value > 0 AND day <= ?", [today]);
  if (!bonus.length) return [];
  const perfect = new Set((await diaries('a.user_id = ?', [userId])).filter((d) => d.stars === 3).map((d) => d.date));
  return bonus.filter((b) => perfect.has(b.day)).map((b) => ({ day: b.day, value: Number(b.value) }));
}

async function starsOf(userId) {
  const today = todayKey();
  const year = today.slice(0, 4);
  const mine = (await diaries('a.user_id = ?', [userId])).map(({ userId: _, ...d }) => d);
  const special = await bonusDaysOf(`${year}-01-01`, `${year}-12-31`);
  // Os 12 meses do ano (nível 1 a 12); arrastando, o profissional vê os outros meses.
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    return buildMonth(m, mine.filter((d) => d.date.startsWith(m)), special.filter((b) => b.day.startsWith(m)), today);
  });
  const draw = special.find((b) => b.kind === 'SORTEIO');
  return {
    current: today.slice(0, 7), year: Number(year), today,
    total: months.reduce((t, m) => t + m.stars, 0),
    bonusGanho: months.reduce((t, m) => t + m.bonusGanho, 0),
    sorteio: draw ? { label: draw.label, ...sorteioStatus(mine, draw.day) } : null,
    months,
  };
}

r.get('/me/estrelas', requireRole('PROFISSIONAL'), async (req, res) => {
  if (!(await gamificationOn())) fail(403, 'As estrelas ainda não estão disponíveis.');
  res.json({ ...(await starsOf(req.user.id)), personagem: req.user.game_character ?? null });
});

/** Personagens do jogo (mesmos ids das imagens em web/public/estrelas/personagens). */
export const PERSONAGENS = ['guerreiro', 'mago', 'arqueira', 'inventora', 'dragao'];

// O profissional escolhe o personagem que o representa no mapa (na primeira entrada e quando quiser trocar).
r.put('/me/personagem', requireRole('PROFISSIONAL'), async (req, res) => {
  const id = String(req.body.id ?? '');
  if (!PERSONAGENS.includes(id)) fail(400, 'Personagem inválido.');
  await q('UPDATE users SET game_character = ? WHERE id = ?', [id, req.user.id]);
  await audit(q, req, 'GAME_CHARACTER_SET', 'user', req.user.id, { before: { id: req.user.game_character ?? null }, after: { id } });
  res.json({ personagem: id });
});

r.get('/manage/workers/:id/estrelas', MANAGERS, async (req, res) => {
  if (!(await workerAllowed(req.user, req.params.id))) fail(404, 'Profissional não encontrado.');
  const [u] = await q("SELECT name FROM users WHERE id = ? AND role = 'PROFISSIONAL'", [req.params.id]);
  if (!u) fail(404, 'Profissional não encontrado.');
  res.json({ name: u.name, ...(await starsOf(req.params.id)) });
});

// ---------- Bônus do mês (só administrador). Um calendário só, para todos os profissionais. ----------
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
const names = async (ids) => (ids.length ? q('SELECT id, name FROM users WHERE id IN (?)', [ids]) : []);

r.get('/manage/bonus', ADMIN, async (req, res) => {
  const month = MONTH.test(req.query.month ?? '') ? req.query.month : todayKey().slice(0, 7);
  const today = todayKey();
  const [set] = await q('SELECT total, set_at FROM bonus_months WHERE month = ?', [month]);
  const days = (await bonusDaysOf(`${month}-01`, lastDay(month))).map((b) => ({ ...b, value: b.value == null ? null : Number(b.value) }));
  const started = days.some((b) => b.kind === 'BONUS' && b.day <= today) || lastDay(month) < today;
  // Ganhadores: diária de 3 estrelas num dia de bônus que já chegou. Gestor vê só quem acompanha.
  const passed = days.filter((b) => b.kind === 'BONUS' && b.day <= today).map((b) => b.day);
  // Janela com um dia de folga para cada lado (fuso); o dia certo é conferido em horário de Brasília.
  const done = passed.length ? (await diaries('j.starts_at BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 2 DAY)', [passed[0], passed.at(-1)])).filter((d) => d.stars === 3) : [];
  const winners = [];
  const seen = new Set();
  for (const d of done) if (passed.includes(d.date) && !seen.has(d.userId + d.date) && seen.add(d.userId + d.date) && (await workerAllowed(req.user, d.userId))) winners.push({ userId: d.userId, day: d.date, value: days.find((b) => b.day === d.date).value });
  const who = new Map((await names([...new Set(winners.map((w) => w.userId))])).map((u) => [u.id, u.name]));
  // Sorteio no mês: quem já está qualificado (15 dias com 3 estrelas no ano + o dia do sorteio com 3 estrelas).
  const draw = days.find((b) => b.kind === 'SORTEIO');
  let sorteio = null;
  if (draw) {
    // ponytail: calcula as estrelas de todos do ano a cada consulta; guardar por profissional se ficar lento.
    const all = await diaries('j.starts_at >= ? AND j.starts_at < ?', [`${draw.day.slice(0, 4)}-01-01`, `${Number(draw.day.slice(0, 4)) + 1}-01-01`]);
    const byUser = Map.groupBy(all, (d) => d.userId);
    const rows = [];
    for (const [userId, ds] of byUser) {
      const st = sorteioStatus(ds, draw.day);
      if (st.threeStarDays > 0 && (await workerAllowed(req.user, userId))) rows.push({ userId, ...st });
    }
    const nm = new Map((await names(rows.map((x) => x.userId))).map((u) => [u.id, u.name]));
    sorteio = { day: draw.day, label: draw.label, need: 15, people: rows.map((x) => ({ ...x, name: nm.get(x.userId) })).sort((a, b) => b.threeStarDays - a.threeStarDays) };
  }
  res.json({
    month, total: set ? Number(set.total) : null, setAt: set?.set_at ?? null, started, today,
    days, winners: winners.map((w) => ({ ...w, name: who.get(w.userId) })), sorteio,
  });
});

r.put('/manage/bonus/:month', ADMIN, async (req, res) => {
  const { month } = req.params;
  if (!MONTH.test(month)) fail(400, 'Mês inválido.');
  const total = Number(req.body.total);
  if (!Number.isFinite(total) || total < 0 || total > 100000) fail(400, 'Informe o valor total do bônus (R$ 0 a R$ 100.000).');
  const today = todayKey();
  if (lastDay(month) < today) fail(409, 'Este mês já terminou.');
  const out = await tx(async (tq) => {
    const days = await tq("SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, kind, value FROM bonus_days WHERE day BETWEEN ? AND ? FOR UPDATE", [`${month}-01`, lastDay(month)]);
    if (days.some((b) => b.kind === 'BONUS' && b.day <= today)) fail(409, 'O bônus deste mês já começou: não dá mais para mudar o valor.');
    const [before] = await tq('SELECT total FROM bonus_months WHERE month = ? FOR UPDATE', [month]);
    // Dias que já passaram (mês corrente) e dias de sorteio ficam de fora do sorteio dos dias.
    const taken = days.filter((b) => b.kind !== 'BONUS').map((b) => b.day);
    for (let d = 1; `${month}-${String(d).padStart(2, '0')}` <= today && d <= 31; d++) taken.push(`${month}-${String(d).padStart(2, '0')}`);
    const plan = planBonuses(month, total, taken);
    if (total > 0 && !plan.length) fail(409, 'Não sobrou dia no mês para os bônus.');
    await tq("DELETE FROM bonus_days WHERE kind = 'BONUS' AND day BETWEEN ? AND ?", [`${month}-01`, lastDay(month)]);
    for (const b of plan) await tq('INSERT INTO bonus_days (day, kind, value) VALUES (?,?,?)', [b.day, b.kind, b.value]);
    await tq('INSERT INTO bonus_months (month, total, set_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE total = VALUES(total), set_by = VALUES(set_by), set_at = CURRENT_TIMESTAMP(3)', [month, total, req.user.id]);
    await audit(tq, req, 'BONUS_MONTH_SET', 'bonus_month', month, { before: before ? { total: Number(before.total) } : undefined, after: { total, days: plan } });
    return plan;
  });
  res.json({ month, total, days: out });
});

export default r;
