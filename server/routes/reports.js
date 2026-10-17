// Relatórios de presença, diárias, horas e exceções; exportação CSV segura (itens 38, 41 e 42 da linha de base).
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole } from '../auth.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { csvCell } from '../rules.js';
import { storeWorkedTime } from './presence.js';

const r = Router();
const MANAGERS = requireRole('GESTOR', 'ADMINISTRADOR');
const MAX_DAYS = 31;
const MAX_ROWS = 50000;
const SCREEN_ROWS = 1000;
const TZ = 'America/Sao_Paulo';
const SOURCE_LABEL = { GPS_VALIDADO: 'GPS', EXCECAO_APROVADA: 'Exceção', FECHAMENTO_ADMINISTRATIVO: 'Fechamento administrativo' };

/** Período (dias operacionais em UTC-3, como em /manage/sessions) e escopo de unidades do usuário. */
async function filters(req) {
  const { from, to, unitId } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) fail(400, 'Informe o período (de / até).');
  const start = new Date(`${from}T00:00:00-03:00`);
  const end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86400e3);
  const days = (end - start) / 86400e3;
  if (days < 1 || days > MAX_DAYS) fail(400, `O período deve ter de 1 a ${MAX_DAYS} dias.`);
  if (unitId) {
    await assertUnit(req.user, unitId);
    return { from, to, unitId, start, end, scope: 'j.unit_id = ?', scopeArgs: [unitId] };
  }
  if (req.user.role === 'ADMINISTRADOR') return { from, to, unitId: null, start, end, scope: '1 = 1', scopeArgs: [] };
  return { from, to, unitId: null, start, end, scope: 'j.unit_id IN (SELECT unit_id FROM unit_managers WHERE user_id = ? AND active = 1)', scopeArgs: [req.user.id] };
}

const range = (f) => [`j.starts_at >= ? AND j.starts_at < ? AND ${f.scope}`, [f.start, f.end, ...f.scopeArgs]];

/** Uma linha por candidatura aprovada no período. */
async function reportRows(f, limit) {
  const [where, args] = range(f);
  const rows = await q(
    `SELECT a.id AS application_id, a.status AS application_status, j.title, j.starts_at, j.daily_value,
            un.id AS unit_id, un.code AS unit_code, un.name AS unit_name, w.name AS worker_name,
            ws.id AS session_id, ws.status AS session_status, ws.worked_min, ws.break_min, ws.sources,
            dc.result, dc.confirmed_at, dc.note, CASE WHEN dc.result IS NULL THEN NULL ELSE COALESCE(cb.name, 'Automático') END AS confirmed_by,
            (SELECT MIN(e.occurred_at) FROM presence_events e WHERE e.work_session_id = ws.id AND e.type = 'CHECK_IN') AS checkin,
            (SELECT MAX(e.occurred_at) FROM presence_events e WHERE e.work_session_id = ws.id AND e.type = 'CHECK_OUT') AS checkout,
            (SELECT GROUP_CONCAT(o.type ORDER BY o.created_at) FROM occurrences o WHERE o.application_id = a.id AND o.status = 'CONFIRMADA') AS occurrences
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN units un ON un.id = j.unit_id JOIN users w ON w.id = a.user_id
     LEFT JOIN work_sessions ws ON ws.application_id = a.id
     LEFT JOIN daily_confirmations dc ON dc.application_id = a.id LEFT JOIN users cb ON cb.id = dc.confirmed_by
     WHERE a.status = 'APROVADA' AND ${where}
     ORDER BY j.starts_at, un.code, w.name LIMIT ?`,
    [...args, limit],
  );
  // Sessões finalizadas antes do Marco 5 ainda não têm horas gravadas: calcula e grava agora (uma vez só).
  for (const row of rows.filter((x) => x.session_status === 'FINALIZADA' && x.worked_min == null)) {
    const worked = await storeWorkedTime(q, row.session_id);
    if (worked) Object.assign(row, { worked_min: worked.workedMin, break_min: worked.breakMin, sources: worked.sources.join(',') });
  }
  return rows;
}

async function buildReport(f, money) {
  const [where, args] = range(f);
  const rows = await reportRows(f, MAX_ROWS);
  const [[jobs], [apps], sources, exceptions, occurrences, [alerts]] = await Promise.all([
    q(`SELECT COUNT(*) AS jobs, COALESCE(SUM(j.positions), 0) AS positions FROM jobs j WHERE j.status <> 'CANCELADA' AND ${where}`, args),
    q(`SELECT COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id WHERE ${where}`, args),
    q(`SELECT e.validation, COUNT(*) AS n FROM presence_events e JOIN work_sessions ws ON ws.id = e.work_session_id
       JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id WHERE ${where} GROUP BY e.validation`, args),
    q(`SELECT x.status, COUNT(*) AS n FROM presence_exceptions x JOIN work_sessions ws ON ws.id = x.work_session_id
       JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id WHERE ${where} GROUP BY x.status`, args),
    q(`SELECT o.type, COUNT(*) AS n FROM occurrences o JOIN applications a ON a.id = o.application_id JOIN jobs j ON j.id = a.job_id
       WHERE o.status = 'CONFIRMADA' AND ${where} GROUP BY o.type`, args),
    q(`SELECT COUNT(*) AS n FROM location_alerts la JOIN work_sessions ws ON ws.id = la.work_session_id
       JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id WHERE ${where}`, args),
  ]);
  const toMap = (list, key) => Object.fromEntries(list.map((x) => [x[key], Number(x.n)]));

  const sum = (list) => {
    const concluded = list.filter((x) => x.result === 'CONCLUIDA');
    return {
      approved: list.length,
      concluded: concluded.length,
      absences: list.filter((x) => x.result === 'NAO_COMPARECEU').length,
      workedMin: list.reduce((t, x) => t + (x.worked_min ?? 0), 0),
      value: Math.round(concluded.reduce((t, x) => t + Number(x.daily_value), 0) * 100) / 100,
    };
  };
  const units = new Map();
  for (const row of rows) {
    if (!units.has(row.unit_id)) units.set(row.unit_id, { unitId: row.unit_id, code: row.unit_code, name: row.unit_name, rows: [] });
    units.get(row.unit_id).rows.push(row);
  }

  const out = {
    period: { from: f.from, to: f.to, unitId: f.unitId },
    indicators: {
      jobs: Number(jobs.jobs), positions: Number(jobs.positions), applications: Number(apps.n), ...sum(rows),
      sources: toMap(sources, 'validation'), exceptions: toMap(exceptions, 'status'), occurrences: toMap(occurrences, 'type'),
      locationAlerts: Number(alerts.n),
    },
    byUnit: [...units.values()].map(({ rows: list, ...u }) => ({ ...u, ...sum(list) })).sort((a, b) => a.code.localeCompare(b.code)),
    rows: rows.slice(0, SCREEN_ROWS),
    truncated: rows.length > SCREEN_ROWS,
    totalRows: rows.length,
  };
  if (money) return { ...out, money };
  // Gestor não vê valores de diária: sai o total, o valor por loja e o valor de cada linha.
  delete out.indicators.value;
  return {
    ...out, money,
    byUnit: out.byUnit.map(({ value, ...u }) => u),
    rows: out.rows.map(({ daily_value, ...x }) => x),
  };
}

/** Valores de diária (R$) no relatório: só o administrador. */
const seesMoney = (user) => user.role === 'ADMINISTRADOR';

r.get('/manage/reports', MANAGERS, async (req, res) => {
  res.json(await buildReport(await filters(req), seesMoney(req.user)));
});

// Formatadores criados uma vez: toLocale*String com fuso cria um novo a cada chamada e deixava o CSV ~10x mais lento.
const DATE_FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ });
const TIME_FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const date = (d) => (d ? DATE_FMT.format(new Date(d)) : '');
const time = (d) => (d ? TIME_FMT.format(new Date(d)) : '');
const hours = (min) => (min == null ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);

const CSV_COLUMNS = [
  ['unidade_codigo', (x) => x.unit_code],
  ['unidade_nome', (x) => x.unit_name],
  ['data_vaga', (x) => date(x.starts_at)],
  ['titulo_vaga', (x) => x.title],
  ['profissional_nome', (x) => x.worker_name],
  ['status_candidatura', (x) => x.application_status],
  ['status_jornada', (x) => x.session_status],
  ['checkin', (x) => time(x.checkin)],
  ['checkout', (x) => time(x.checkout)],
  ['horas_trabalhadas', (x) => hours(x.worked_min)],
  ['pausas_min', (x) => x.break_min ?? ''],
  ['origem_registros', (x) => (x.sources ? x.sources.split(',').map((s) => SOURCE_LABEL[s] ?? s).join(' + ') : '')],
  ['resultado_diaria', (x) => x.result ?? ''],
  ['valor_diaria', (x) => Number(x.daily_value).toFixed(2).replace('.', ',')],
  ['data_confirmacao', (x) => (x.confirmed_at ? `${date(x.confirmed_at)} ${time(x.confirmed_at)}` : '')],
  ['confirmado_por', (x) => x.confirmed_by ?? ''],
  ['ocorrencias', (x) => x.occurrences ?? ''],
  ['observacao', (x) => x.note ?? ''],
];

// Sem documentos e sem e-mail do profissional; toda exportação fica na auditoria.
r.get('/manage/reports/export.csv', MANAGERS, async (req, res) => {
  const f = await filters(req);
  const rows = await reportRows(f, MAX_ROWS);
  const cols = seesMoney(req.user) ? CSV_COLUMNS : CSV_COLUMNS.filter(([name]) => name !== 'valor_diaria');
  const lines = [cols.map(([name]) => csvCell(name)).join(';'), ...rows.map((x) => cols.map(([, get]) => csvCell(get(x))).join(';'))];
  await audit(q, req, 'REPORT_EXPORT', 'report', null, { after: { from: f.from, to: f.to, unitId: f.unitId, rows: rows.length } });
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="upservice-diarias-${f.from}-a-${f.to}.csv"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(`﻿${lines.join('\r\n')}\r\n`);
});

export default r;
