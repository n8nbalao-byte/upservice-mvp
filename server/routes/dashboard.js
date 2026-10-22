// Painel inicial do gestor/admin, busca do topo e calendário. Só leitura, sempre no escopo de unidades do usuário.
import { Router } from 'express';
import { assertUnit, requireRole, unitScope, workerScope } from '../auth.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { DOC_TYPES } from './worker.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');

/** Situação de um tipo de documento: aprovado vale mais que em análise, que vale mais que reprovado; sem envio = FALTA. */
const docStatus = (st) => (st.includes('APROVADO') ? 'APROVADO' : st.includes('PENDENTE') ? 'PENDENTE' : st.includes('REJEITADO') ? 'REJEITADO' : 'FALTA');

/** Profissionais do escopo e a situação do cadastro de cada um. Habilitado = a mesma regra da candidatura (staffing.js):
 *  conta ativa, termos aceitos e os 4 documentos aprovados. "Documento pendente" = falta algum dos 4 aprovado. */
export async function cadastros(user) {
  const [wWhere, wArgs] = workerScope(user, 'u.id');
  const base = `FROM users u WHERE u.role = 'PROFISSIONAL' AND u.deleted_at IS NULL AND u.status <> 'INATIVO' AND ${wWhere}`;
  const [pros, docs] = await Promise.all([
    q(`SELECT u.id, u.name, u.email, u.status, u.created_at, p.user_id IS NOT NULL AS perfil, p.terms_accepted_at IS NOT NULL AS termos
       FROM users u LEFT JOIN worker_profiles p ON p.user_id = u.id WHERE u.role = 'PROFISSIONAL' AND u.deleted_at IS NULL AND u.status <> 'INATIVO' AND ${wWhere}`, wArgs),
    q(`SELECT d.user_id, d.type, GROUP_CONCAT(DISTINCT d.status) AS st FROM worker_documents d WHERE d.user_id IN (SELECT u.id ${base}) GROUP BY d.user_id, d.type`, wArgs),
  ]);
  const porUsuario = new Map();
  for (const d of docs) { if (!porUsuario.has(d.user_id)) porUsuario.set(d.user_id, {}); porUsuario.get(d.user_id)[d.type] = docStatus(String(d.st)); }
  return pros.map((p) => {
    const doc = Object.fromEntries(DOC_TYPES.map((t) => [t, porUsuario.get(p.id)?.[t] ?? 'FALTA']));
    const vals = Object.values(doc);
    const docsOk = vals.every((v) => v === 'APROVADO');
    return {
      id: p.id, name: p.name, email: p.email, status: p.status, createdAt: p.created_at, perfil: !!p.perfil, docs: doc,
      habilitado: docsOk && p.status === 'ATIVO' && !!p.termos,
      // O que a gestão precisa fazer primeiro: analisar o que chegou; depois, quem teve documento reprovado; por fim, quem não enviou.
      situacao: docsOk ? null : vals.includes('PENDENTE') ? 'EM_ANALISE' : vals.includes('REJEITADO') ? 'REPROVADO' : 'FALTA',
    };
  });
}

// Lista de quem ainda não está com os 4 documentos aprovados (em análise primeiro), para cobrar ou analisar.
const ORDEM = { EM_ANALISE: 0, REPROVADO: 1, FALTA: 2 };
r.get('/manage/cadastros-pendentes', MANAGERS, async (req, res) => {
  const items = (await cadastros(req.user)).filter((p) => p.situacao)
    .sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao] || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  res.json({ items });
});

r.get('/manage/dashboard', MANAGERS, async (req, res) => {
  const [uWhere, uArgs] = unitScope(req.user, 'j.unit_id');
  const [wWhere, wArgs] = workerScope(req.user, 'd.id');
  const [dWhere, dArgs] = workerScope(req.user, 'd.user_id');
  const now = new Date();
  // ponytail: dia operacional em UTC-3, igual a /manage/sessions.
  const dayStart = new Date(`${now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}T00:00:00-03:00`);
  const today = [dayStart, new Date(dayStart.getTime() + 86400e3), ...uArgs];
  const [[workers], [jobs], [docs], sessions, [exceptions], latest, pros, [usuarios]] = await Promise.all([
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
       FROM jobs j JOIN units un ON un.id = j.unit_id WHERE ${uWhere} ORDER BY j.created_at DESC LIMIT 12`, uArgs),
    cadastros(req.user),
    // Total de contas (todos os papéis): só o administrador vê.
    req.user.role === 'ADMINISTRADOR' ? q('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL') : [{ n: null }],
  ]);
  res.json({
    serverNow: now,
    workers: Number(workers.n),
    openJobs: { jobs: Number(jobs.n), positions: Number(jobs.positions), filled: Number(jobs.filled) },
    pendingDocuments: { documents: Number(docs.n), people: Number(docs.people) },
    today: { ...Object.fromEntries(sessions.map((x) => [x.status, Number(x.n)])), exceptions: Number(exceptions.n) },
    latestJobs: latest,
    cadastros: {
      usuarios: usuarios.n == null ? null : Number(usuarios.n),
      profissionais: pros.length,
      habilitados: pros.filter((p) => p.habilitado).length,
      docPendentes: pros.filter((p) => p.situacao).length,
      emAnalise: pros.filter((p) => p.situacao === 'EM_ANALISE').length,
    },
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

const CALENDAR_MAX_DAYS = 42;
const CALENDAR_MAX_JOBS = 3000;
const OPEN_SESSION = "'EM_ATIVIDADE','EM_PAUSA','PAUSA_EXCEDIDA','PENDENTE_DE_EXCECAO','PENDENTE_DE_FECHAMENTO'";

// Calendário: vagas do período (dias operacionais em UTC-3, como /manage/sessions) com preenchimento e jornadas.
r.get('/manage/calendar', MANAGERS, async (req, res) => {
  const { from, to, unitId } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) fail(400, 'Informe o período (de / até).');
  const start = new Date(`${from}T00:00:00-03:00`);
  const end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86400e3);
  const days = (end - start) / 86400e3;
  if (!(days >= 1 && days <= CALENDAR_MAX_DAYS)) fail(400, `O período deve ter de 1 a ${CALENDAR_MAX_DAYS} dias.`);
  let where, args;
  if (unitId) {
    await assertUnit(req.user, String(unitId)); // 404 para loja fora do acesso, sem revelar que existe
    [where, args] = ['j.unit_id = ?', [String(unitId)]];
  } else [where, args] = unitScope(req.user, 'j.unit_id');
  const rows = await q(
    `SELECT j.id, j.title, j.starts_at, j.ends_at, j.positions, j.status, un.id AS unit_id, un.code, un.filial, un.name AS unit_name,
            (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'APROVADA') AS approved,
            (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'PENDENTE') AS reserve,
            (SELECT COUNT(*) FROM applications a JOIN work_sessions ws ON ws.application_id = a.id WHERE a.job_id = j.id AND ws.status IN (${OPEN_SESSION})) AS working,
            (SELECT COUNT(*) FROM applications a JOIN work_sessions ws ON ws.application_id = a.id WHERE a.job_id = j.id AND ws.status = 'FINALIZADA') AS finished
     FROM jobs j JOIN units un ON un.id = j.unit_id
     WHERE j.starts_at >= ? AND j.starts_at < ? AND ${where}
     ORDER BY j.starts_at, un.code LIMIT ?`,
    [start, end, ...args, CALENDAR_MAX_JOBS + 1],
  );
  const num = ['positions', 'approved', 'reserve', 'working', 'finished'];
  res.json({
    from, to, truncated: rows.length > CALENDAR_MAX_JOBS,
    jobs: rows.slice(0, CALENDAR_MAX_JOBS).map((j) => ({ ...j, ...Object.fromEntries(num.map((k) => [k, Number(j[k])])) })),
  });
});

export default r;
