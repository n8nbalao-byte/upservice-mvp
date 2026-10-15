// Teste de carga local (item 50): npm run loadtest. NUNCA apontar para produção.
// Cria o banco descartável LOAD_DATABASE_URL, semeia volume de operação real e mede as rotas mais usadas.
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const url = process.env.LOAD_DATABASE_URL || 'mysql://root:dev@localhost:3306/upservice_load';
if (/hostinger|u770915504/.test(url)) throw new Error('Teste de carga não roda contra produção.');

const UNITS = 104;
const WORKERS = 3000;
const MANAGERS = 20;
const JOBS_PER_DAY = 400;
const DAYS = 7;

// ---------- banco descartável ----------
const server = new URL(url);
const dbName = server.pathname.slice(1);
server.pathname = '/';
const root = await mysql.createConnection({ uri: server.toString() });
await root.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
await root.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4`);
await root.end();
Object.assign(process.env, { DATABASE_URL: url, DEV_LOGIN: '1', NODE_ENV: 'loadtest', STORAGE_DIR: process.env.STORAGE_DIR || './storage-load' });
await (await import('../server/migrate.js')).migrate(url);
const { q, closeDb } = await import('../server/db.js');

const bulk = async (table, cols, rows) => {
  for (let i = 0; i < rows.length; i += 1000) await q(`INSERT INTO ${table} (${cols.join(',')}) VALUES ?`, [rows.slice(i, i + 1000)]);
};
const pick = (list, i) => list[i % list.length];

// ---------- semente ----------
console.time('semente');
const units = Array.from({ length: UNITS }, (_, i) => ({
  id: randomUUID(), code: `ATC-${String(i + 1).padStart(3, '0')}`, lat: -23.55 + ((i % 13) - 6) * 0.03, lng: -46.63 + (Math.floor(i / 13) - 4) * 0.04,
}));
await bulk('units', ['id', 'code', 'name', 'address', 'lat', 'lng'], units.map((u) => [u.id, u.code, `Loja ${u.code}`, 'Endereço de teste, 1', u.lat, u.lng]));

const admin = { id: randomUUID(), email: 'admin@load.dev' };
const managers = Array.from({ length: MANAGERS }, (_, i) => ({ id: randomUUID(), email: `gestor${i}@load.dev` }));
const workers = Array.from({ length: WORKERS }, (_, i) => ({ id: randomUUID(), email: `p${i}@load.dev` }));
await bulk('users', ['id', 'email', 'name', 'role'], [
  [admin.id, admin.email, 'Admin', 'ADMINISTRADOR'],
  ...managers.map((m, i) => [m.id, m.email, `Gestor ${i}`, 'GESTOR']),
  ...workers.map((w, i) => [w.id, w.email, `Profissional ${i}`, 'PROFISSIONAL']),
]);
await bulk('unit_managers', ['user_id', 'unit_id'], units.map((u, i) => [pick(managers, i).id, u.id]));
await bulk('worker_profiles', ['user_id', 'cpf', 'rg', 'phone', 'address', 'city', 'uf', 'emergency_name', 'emergency_phone', 'terms_accepted_at'],
  workers.map((w, i) => [w.id, String(10000000000 + i), '1234567', '11999990000', 'Rua X, 1', 'São Paulo', 'SP', 'Contato', '11988880000', new Date()]));
await bulk('worker_documents', ['id', 'user_id', 'type', 'storage_key', 'sha256', 'size', 'mime', 'status'],
  workers.flatMap((w, i) => ['CPF', 'RG', 'COMPROVANTE', 'SELFIE'].map((t) => [randomUUID(), w.id, t, `docs/${w.id}/${t}.jpg`, '0'.repeat(64), 1000, 'image/jpeg', i % 10 === 0 ? 'PENDENTE' : 'APROVADO'])));

const today = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}T08:00:00-03:00`);
const jobs = [];
const apps = [];
const sessions = [];
const events = [];
let w = 0;
for (let d = -(DAYS - 1); d <= 0; d++) {
  for (let k = 0; k < JOBS_PER_DAY; k++) {
    const unit = pick(units, k);
    const starts = new Date(today.getTime() + d * 86400e3 + (k % 3) * 2 * 3600e3);
    const ends = new Date(starts.getTime() + 8 * 3600e3);
    const positions = 1 + (k % 3);
    const job = { id: randomUUID(), unit, starts, ends, positions };
    jobs.push([job.id, unit.id, 'Repositor', starts, ends, positions, 120, 1, 15, d < 0 ? 'ENCERRADA' : 'ABERTA', admin.id]);
    for (let a = 0; a < 5; a++) {
      const worker = pick(workers, w++);
      const approved = a < positions;
      const appId = randomUUID();
      apps.push([appId, job.id, worker.id, approved ? 'APROVADA' : d < 0 ? 'RECUSADA' : 'PENDENTE']);
      if (!approved) continue;
      const sid = randomUUID();
      const past = d < 0;
      sessions.push([sid, appId, past ? 'FINALIZADA' : 'EM_ATIVIDADE', past ? 1 : 0, past ? 465 : null, past ? 15 : null, past ? 'GPS_VALIDADO' : null]);
      const ev = (type, at) => events.push([randomUUID(), sid, type, worker.id, at, unit.lat, unit.lng, 20, unit.lat, unit.lng, 10, 300, 'GPS_VALIDADO']);
      ev('CHECK_IN', new Date(starts.getTime() + 5 * 60e3));
      if (past) {
        ev('PAUSE_START', new Date(starts.getTime() + 4 * 3600e3));
        ev('PAUSE_END', new Date(starts.getTime() + 4 * 3600e3 + 15 * 60e3));
        ev('CHECK_OUT', ends);
      }
    }
  }
}
await bulk('jobs', ['id', 'unit_id', 'title', 'starts_at', 'ends_at', 'positions', 'daily_value', 'break_count', 'break_minutes', 'status', 'created_by'], jobs);
await bulk('applications', ['id', 'job_id', 'user_id', 'status'], apps);
await bulk('work_sessions', ['id', 'application_id', 'status', 'breaks_used', 'worked_min', 'break_min', 'sources'], sessions);
await bulk('presence_events', ['id', 'work_session_id', 'type', 'actor_user_id', 'occurred_at', 'lat', 'lng', 'accuracy_m', 'unit_lat', 'unit_lng', 'distance_m', 'radius_m', 'validation'], events);
await q(`INSERT INTO daily_confirmations (application_id, result, confirmed_by)
         SELECT ws.application_id, 'CONCLUIDA', ? FROM work_sessions ws WHERE ws.status = 'FINALIZADA'`, [admin.id]);
console.timeEnd('semente');
console.log(`${UNITS} lojas, ${WORKERS} profissionais, ${jobs.length} vagas, ${apps.length} candidaturas, ${sessions.length} jornadas, ${events.length} registros`);

// ---------- --seed-only: banco de demonstração para revisão visual (um caso de cada estado da interface) ----------
if (process.argv.includes('--seed-only')) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  // JPEG 1x1 válido: placeholder das selfies de demonstração.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  await mkdir(`${process.env.STORAGE_DIR}/demo`, { recursive: true });
  await writeFile(`${process.env.STORAGE_DIR}/demo/selfie.jpg`, jpeg);
  await q("UPDATE presence_events SET selfie_key = 'demo/selfie.jpg', selfie_sha256 = REPEAT('0', 64)");
  await q("UPDATE worker_documents SET storage_key = 'demo/selfie.jpg' WHERE type = 'SELFIE'");
  const [unit0] = await q('SELECT unit_id FROM unit_managers WHERE user_id = ? ORDER BY unit_id LIMIT 1', [managers[0].id]);
  const today5 = await q(
    `SELECT ws.id, a.id AS app_id, a.user_id, j.unit_id FROM work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id
     WHERE ws.status = 'EM_ATIVIDADE' AND j.unit_id = ? ORDER BY j.starts_at LIMIT 6`, [unit0.unit_id]);
  const [exc, pause, close, alert, fresh] = today5;
  const now = new Date();
  // Exceção pendente
  await q("UPDATE work_sessions SET status = 'PENDENTE_DE_EXCECAO' WHERE id = ?", [exc.id]);
  await q(`INSERT INTO presence_exceptions (id, work_session_id, type, reason, error_message, message, requested_by, requested_at, distance_m, selfie_key, selfie_sha256, prev_status)
           VALUES (?, ?, 'PAUSE_START', 'GPS_INDISPONIVEL', 'Localização indisponível', 'Estou no estoque, o GPS não pega aqui dentro', ?, ?, NULL, 'demo/selfie.jpg', REPEAT('0', 64), 'EM_ATIVIDADE')`,
  [randomUUID(), exc.id, exc.user_id, now]);
  // Pausa excedida + ocorrência pendente
  await q("UPDATE work_sessions SET status = 'PAUSA_EXCEDIDA', breaks_used = 1, break_ends_at = ? WHERE id = ?", [new Date(now - 10 * 60e3), pause.id]);
  await q("INSERT INTO occurrences (id, user_id, unit_id, work_session_id, application_id, type, description) VALUES (?, ?, ?, ?, ?, 'PAUSA_EXCEDIDA', 'Pausa passou do tempo configurado na vaga')", [randomUUID(), pause.user_id, pause.unit_id, pause.id, pause.app_id]);
  // Checkout pendente (fechamento administrativo)
  await q("UPDATE work_sessions SET status = 'PENDENTE_DE_FECHAMENTO', reported_end_at = ?, reported_end_note = 'Saí às pressas' WHERE id = ?", [new Date(now - 60 * 60e3), close.id]);
  // Saída do raio não vista + leitura de localização recente
  await q('UPDATE work_sessions SET last_ping_at = ?, last_ping_distance_m = 840, last_ping_accuracy_m = 18, last_ping_inside = 0 WHERE id = ?', [now, alert.id]);
  await q('INSERT INTO location_alerts (id, work_session_id, at, lat, lng, accuracy_m, distance_m) VALUES (?, ?, ?, -23.56, -46.63, 18, 840)', [randomUUID(), alert.id, now]);
  await q('UPDATE work_sessions SET last_ping_at = ?, last_ping_distance_m = 42, last_ping_accuracy_m = 12, last_ping_inside = 1 WHERE id = ?', [now, fresh.id]);
  // Profissional bloqueado com contestação aberta
  const blocked = workers[WORKERS - 1];
  const pid = randomUUID();
  await q("INSERT INTO penalties (id, user_id, type, reason, starts_at, ends_at) VALUES (?, ?, 'BLOQUEIO_TEMPORARIO', '3 faltas confirmadas', ?, ?)", [pid, blocked.id, now, new Date(now.getTime() + 15 * 86400e3)]);
  await q("UPDATE users SET status = 'BLOQUEADO_TEMPORARIAMENTE' WHERE id = ?", [blocked.id]);
  await q("INSERT INTO contestations (id, protocol, user_id, penalty_id, channel, message, created_by) VALUES (?, 'CT-20261014-A1B2', ?, ?, 'APP', 'Estive doente, tenho atestado médico das três datas.', ?)", [randomUUID(), blocked.id, pid, blocked.id]);
  await q('INSERT INTO applications (id, job_id, user_id, status) SELECT UUID(), a.job_id, ?, \'APROVADA\' FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.unit_id = ? LIMIT 1', [blocked.id, unit0.unit_id]).catch(() => {});
  const [worker] = await q('SELECT u.email FROM users u JOIN applications a ON a.user_id = u.id WHERE a.id = ?', [fresh.app_id]);
  console.log(JSON.stringify({ admin: admin.email, manager: managers[0].email, worker: worker.email, workerSession: fresh.id, blocked: blocked.email, unit: unit0.unit_id }));
  await closeDb();
  process.exit(0);
}

// ---------- app + logins ----------
const { app } = await import('../server/app.js');
const http = app.listen(0);
const base = `http://localhost:${http.address().port}`;
const login = async (email) => (await fetch(`${base}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).headers.getSetCookie()[0].split(';')[0];

const adminCookie = await login(admin.email);
const manager = managers[0];
const managerCookie = await login(manager.email);
const [managerUnit] = await q('SELECT unit_id FROM unit_managers WHERE user_id = ? LIMIT 1', [manager.id]);
const active = await q(
  `SELECT ws.id, u.email, j.unit_id FROM work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN users u ON u.id = a.user_id
   JOIN jobs j ON j.id = a.job_id WHERE ws.status = 'EM_ATIVIDADE' LIMIT 50`,
);
const workerCookies = [];
for (const x of active) workerCookies.push({ cookie: await login(x.email), session: x.id, unit: units.find((u) => u.id === x.unit_id) });

// ---------- carga ----------
async function scenario(name, total, concurrency, request) {
  const times = [];
  let errors = 0;
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const i = next++;
      const t0 = performance.now();
      const res = await request(i).catch(() => null);
      times.push(performance.now() - t0);
      if (!res || res.status >= 400) errors++;
      await res?.arrayBuffer().catch(() => {});
    }
  }));
  const secs = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  const p = (x) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * x))]);
  return { rota: name, req: total, conc: concurrency, 'req/s': Math.round(total / secs), p50_ms: p(0.5), p95_ms: p(0.95), max_ms: Math.round(times.at(-1)), erros: errors };
}

const get = (path, cookie) => fetch(base + path, { headers: { cookie } });
const day = (o) => new Date(Date.now() + o * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const results = [];
results.push(await scenario('GET /jobs (profissional, por proximidade)', 1000, 50, (i) => {
  const wk = pick(workerCookies, i);
  return get(`/api/jobs?lat=${wk.unit.lat}&lng=${wk.unit.lng}`, wk.cookie);
}));
results.push(await scenario('POST /sessions/:id/ping', 1000, 50, (i) => {
  const wk = pick(workerCookies, i);
  return fetch(`${base}/api/sessions/${wk.session}/ping`, { method: 'POST', headers: { cookie: wk.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ lat: wk.unit.lat, lng: wk.unit.lng, accuracy: 20 }) });
}));
results.push(await scenario('GET /manage/inbox (gestor)', 500, 20, () => get('/api/manage/inbox', managerCookie)));
results.push(await scenario('GET /manage/inbox (admin, 104 lojas)', 300, 10, () => get('/api/manage/inbox', adminCookie)));
results.push(await scenario('GET /manage/sessions (gestor, dia)', 500, 20, () => get(`/api/manage/sessions?unitId=${managerUnit.unit_id}&date=${day(0)}`, managerCookie)));
results.push(await scenario('GET /manage/reports (admin, 7 dias, 104 lojas)', 30, 3, () => get(`/api/manage/reports?from=${day(-6)}&to=${day(0)}`, adminCookie)));
results.push(await scenario('GET /manage/reports/export.csv (admin, 7 dias)', 10, 2, () => get(`/api/manage/reports/export.csv?from=${day(-6)}&to=${day(0)}`, adminCookie)));
console.table(results);

http.close();
await closeDb();
process.exit(results.some((r) => r.erros) ? 1 : 0);
