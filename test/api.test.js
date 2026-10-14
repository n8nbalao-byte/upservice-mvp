// Integração contra um MariaDB/MySQL descartável (TEST_DATABASE_URL). O banco é apagado e recriado.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import mysql from 'mysql2/promise';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL não definido';
const UNIT = { lat: -23.55, lng: -46.63 };
const ADDR = { cep: '03653-000', street: 'Av. Amador Bueno da Veiga', number: '2521', district: 'Penha de França', city: 'São Paulo', uf: 'SP' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]).toString('base64');

let server, base, q, closeDb, sweepBreaks;
const s = {}; // estado compartilhado entre os testes, que rodam em sequência

async function call(cookie, method, route, body) {
  const res = await fetch(base + route, {
    method,
    headers: { cookie: cookie ?? '', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? await res.json() : null, res };
}

async function login(email) {
  const { res } = await call(null, 'POST', '/api/auth/dev', { email, name: email.split('@')[0] });
  return res.headers.getSetCookie()[0].split(';')[0];
}

async function completeWorker(cookie, cpf) {
  assert.equal((await call(cookie, 'PUT', '/api/me/profile', {
    name: 'Fulano de Tal', cpf, rg: '123456789', phone: '11999990000', address: 'Rua A, 1', city: 'São Paulo', uf: 'SP',
    emergencyName: 'Ciclano', emergencyPhone: '11988880000', role: 'ADMINISTRADOR',
  })).status, 200);
  for (const type of ['CPF', 'RG', 'COMPROVANTE']) assert.equal((await call(cookie, 'POST', '/api/me/documents', { type, file: JPEG })).status, 200);
  const done = await call(cookie, 'POST', '/api/me/terms', { accept: true });
  assert.equal(done.body.complete, true);
}

async function event(cookie, sessionId, type, where = UNIT, token) {
  token ??= (await call(cookie, 'POST', `/api/sessions/${sessionId}/token`, {})).body.token;
  return call(cookie, 'POST', `/api/sessions/${sessionId}/events`, { type, token, ...where, accuracy: 20, clientTs: new Date().toISOString(), selfie: JPEG });
}

before(async () => {
  if (skip) return;
  const server0 = new URL(url);
  const dbName = server0.pathname.slice(1);
  server0.pathname = '/';
  const admin = await mysql.createConnection({ uri: server0.toString() });
  await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4`);
  await admin.end();

  Object.assign(process.env, { DATABASE_URL: url, DEV_LOGIN: '1', NODE_ENV: 'test', STORAGE_DIR: await mkdtemp(path.join(tmpdir(), 'upservice-')) });
  delete process.env.SMTP_USER;
  await (await import('../server/migrate.js')).migrate(url);
  ({ q, closeDb } = await import('../server/db.js'));
  ({ sweepBreaks } = await import('../server/routes/presence.js'));
  const { app } = await import('../server/app.js');
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;

  s.admin = await login('admin@test.dev');
  await q("UPDATE users SET role = 'ADMINISTRADOR' WHERE email = 'admin@test.dev'");
  s.unitA = (await call(s.admin, 'POST', '/api/units', { name: 'Loja A', ...ADDR, ...UNIT })).body.id;
  s.unitB = (await call(s.admin, 'POST', '/api/units', { name: 'Loja B', ...ADDR, lat: -22.9, lng: -43.2 })).body.id;
  const codes = (await q('SELECT code FROM units ORDER BY code')).map((u) => u.code);
  assert.deepEqual(codes, ['ATC-001', 'ATC-002'], 'código gerado em sequência');

  s.gestor = await login('gestor@test.dev');
  const [g] = await q("SELECT id FROM users WHERE email = 'gestor@test.dev'");
  assert.equal((await call(s.admin, 'PATCH', `/api/admin/users/${g.id}`, { role: 'GESTOR', reason: 'Gestor da loja A no piloto' })).status, 200);
  assert.equal((await call(s.admin, 'PUT', `/api/admin/users/${g.id}/units`, { unitIds: [s.unitA] })).status, 200);

  s.w1 = await login('w1@test.dev');
  s.w2 = await login('w2@test.dev');
  await completeWorker(s.w1, '529.982.247-25');
  await completeWorker(s.w2, '111.444.777-35');
});

after(async () => {
  server?.close();
  await closeDb?.();
});

test('papel nunca vem do cliente', { skip }, async () => {
  assert.equal((await call(s.w1, 'GET', '/api/me')).body.user.role, 'PROFISSIONAL');
  assert.equal((await call(s.w1, 'GET', '/api/admin/users')).status, 403);
  assert.equal((await call(s.w1, 'POST', '/api/units', { code: 'X-1' })).status, 403);
});

test('CPF duplicado é recusado', { skip }, async () => {
  const w3 = await login('w3@test.dev');
  const r = await call(w3, 'PUT', '/api/me/profile', {
    name: 'Outra Pessoa', cpf: '52998224725', rg: '1234', phone: '11999990000', address: 'Rua B, 2', city: 'SP', uf: 'SP', emergencyName: 'X', emergencyPhone: '11999990000',
  });
  assert.equal(r.status, 409);
  const [p] = await q("SELECT address FROM worker_profiles WHERE cpf = '52998224725'");
  assert.equal(p.address, 'Rua A, 1', 'perfil do dono do CPF não pode ser sobrescrito');
});

test('gestor não acessa unidade sem vínculo', { skip }, async () => {
  assert.equal((await call(s.gestor, 'GET', `/api/manage/jobs?unitId=${s.unitB}`)).status, 404);
  const starts = new Date(Date.now() + 3600e3);
  const r = await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitB, title: 'Repositor', startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 1, dailyValue: 120, breakCount: 1, breakMinutes: 15, publish: true,
  });
  assert.equal(r.status, 404);
});

test('aprovações concorrentes respeitam o limite de posições', { skip }, async () => {
  const starts = new Date(Date.now() + 3600e3); // dentro da janela de check-in (2 h antes)
  const created = await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Repositor', startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 1, dailyValue: 150.5, breakCount: 1, breakMinutes: 15, publish: true,
  });
  assert.equal(created.status, 201);
  s.job = created.body.id;

  const jobs = (await call(s.w1, 'GET', `/api/jobs?lat=${UNIT.lat}&lng=${UNIT.lng}`)).body;
  assert.equal(jobs[0].id, s.job);
  assert.equal(jobs[0].distance_m, 0);
  assert.equal((await call(s.w1, 'POST', `/api/jobs/${s.job}/apply`, {})).status, 201);
  assert.equal((await call(s.w1, 'POST', `/api/jobs/${s.job}/apply`, {})).status, 409, 'candidatura duplicada');
  assert.equal((await call(s.w2, 'POST', `/api/jobs/${s.job}/apply`, {})).status, 201);

  const apps = (await call(s.gestor, 'GET', `/api/manage/jobs/${s.job}/applications`)).body.applications;
  const results = await Promise.all(apps.map((a) => call(s.gestor, 'POST', `/api/manage/applications/${a.id}/decide`, { decision: 'APROVADA' })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);

  const mine = (who) => call(who, 'GET', '/api/me/applications').then((r) => r.body[0]);
  const [a1, a2] = [await mine(s.w1), await mine(s.w2)];
  s.winner = a1.status === 'APROVADA' ? s.w1 : s.w2;
  s.loser = s.winner === s.w1 ? s.w2 : s.w1;
  s.session = (a1.status === 'APROVADA' ? a1 : a2).session_id;
  s.application = (a1.status === 'APROVADA' ? a1 : a2).id;
  assert.ok(s.session);
});

test('presença: raio, token único, pausas e checkout', { skip }, async () => {
  const count = async () => (await q('SELECT COUNT(*) AS n FROM presence_events WHERE work_session_id = ?', [s.session]))[0].n;

  const far = await event(s.winner, s.session, 'CHECK_IN', { lat: -23.56, lng: -46.63 });
  assert.equal(far.status, 422);
  assert.match(far.body.error, /da loja/);
  assert.equal(await count(), 0, 'fora do raio não cria evento');
  const [rejected] = await q("SELECT 1 FROM audit_events WHERE action = 'PRESENCE_REJECTED' AND entity_id = ?", [s.session]);
  assert.ok(rejected, 'tentativa recusada fica na auditoria');

  assert.equal((await event(s.loser, s.session, 'CHECK_IN')).status, 404, 'outra pessoa não usa a atividade');

  const token = (await call(s.winner, 'POST', `/api/sessions/${s.session}/token`, {})).body.token;
  assert.equal((await event(s.winner, s.session, 'CHECK_IN', UNIT, token)).status, 200);
  assert.equal((await event(s.winner, s.session, 'PAUSE_START', UNIT, token)).status, 409, 'token reaproveitado');
  assert.equal((await event(s.winner, s.session, 'CHECK_IN')).status, 409, 'check-in duplicado');

  assert.equal((await event(s.winner, s.session, 'PAUSE_START')).status, 200);
  assert.equal((await event(s.winner, s.session, 'CHECK_OUT')).status, 409, 'checkout em pausa');

  await q('UPDATE work_sessions SET break_ends_at = ? WHERE id = ?', [new Date(Date.now() - 1000), s.session]);
  await sweepBreaks();
  const [ws] = await q('SELECT status, break_email_sent_at FROM work_sessions WHERE id = ?', [s.session]);
  assert.equal(ws.status, 'PAUSA_EXCEDIDA');
  assert.ok(ws.break_email_sent_at);

  assert.equal((await event(s.winner, s.session, 'PAUSE_END')).status, 200);
  assert.equal((await event(s.winner, s.session, 'PAUSE_START')).status, 409, 'só 1 pausa nesta vaga');
  assert.equal((await event(s.winner, s.session, 'CHECK_OUT')).status, 200);
  const detail = (await call(s.winner, 'GET', `/api/me/sessions/${s.session}`)).body;
  assert.equal(detail.session.status, 'FINALIZADA');
  assert.equal(detail.events.length, 4);
  assert.ok(detail.worked);
});

test('selfies e documentos: só dono, gestor da unidade e admin', { skip }, async () => {
  const [ev] = await q('SELECT id FROM presence_events WHERE work_session_id = ? LIMIT 1', [s.session]);
  assert.equal((await call(s.winner, 'GET', `/api/files/selfie/${ev.id}`)).status, 200);
  assert.equal((await call(s.gestor, 'GET', `/api/files/selfie/${ev.id}`)).status, 200);
  assert.equal((await call(s.loser, 'GET', `/api/files/selfie/${ev.id}`)).status, 404);

  const [doc] = await q("SELECT d.id FROM worker_documents d JOIN users u ON u.id = d.user_id WHERE u.email = 'w1@test.dev' LIMIT 1");
  assert.equal((await call(s.w1, 'GET', `/api/files/doc/${doc.id}`)).status, 200);
  assert.equal((await call(s.w2, 'GET', `/api/files/doc/${doc.id}`)).status, 404);
  const [views] = await q("SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('SELFIE_VIEW','DOCUMENT_VIEW')");
  assert.ok(views.n >= 3);
});

test('confirmação da diária soma no valor a receber', { skip }, async () => {
  const r = await call(s.gestor, 'POST', `/api/manage/applications/${s.application}/confirm`, { result: 'CONCLUIDA' });
  assert.equal(r.status, 200);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${s.application}/confirm`, { result: 'CONCLUIDA' })).status, 409);
  const summary = (await call(s.winner, 'GET', '/api/me/summary')).body;
  assert.equal(summary.concluidas, 1);
  assert.equal(summary.valor, 150.5);
});

test('fila de documentos pendentes respeita o escopo do gestor', { skip }, async () => {
  const w4 = await login('w4@test.dev');
  await completeWorker(w4, '935.411.347-80'); // documentos enviados, sem candidatura
  const ids = async (who) => (await call(who, 'GET', '/api/manage/documents/pending')).body.map((r) => r.email);
  const admin = await ids(s.admin);
  const gestor = await ids(s.gestor);
  assert.ok(admin.includes('w4@test.dev') && admin.includes('w1@test.dev'));
  assert.ok(!gestor.includes('w4@test.dev'), 'gestor não vê quem não se candidatou nas suas lojas');
  assert.ok(gestor.includes('w1@test.dev'));
  assert.equal((await call(s.w1, 'GET', '/api/manage/documents/pending')).status, 403);
});

test('unidade bloqueada não recebe vagas; usuário bloqueado perde a sessão', { skip }, async () => {
  assert.equal((await call(s.admin, 'POST', `/api/units/${s.unitA}/status`, { status: 'BLOQUEADA_FINANCEIRA', reason: 'Pagamento em atraso desde setembro' })).status, 200);
  const starts = new Date(Date.now() + 3600e3);
  const r = await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Repositor', startsAt: starts, endsAt: new Date(starts.getTime() + 3600e3), positions: 1, dailyValue: 100, breakCount: 0, breakMinutes: 15,
  });
  assert.equal(r.status, 409);

  const [u] = await q("SELECT id FROM users WHERE email = 'w2@test.dev'");
  await call(s.admin, 'PATCH', `/api/admin/users/${u.id}`, { status: 'BLOQUEADO_PERMANENTEMENTE', reason: 'Teste de bloqueio permanente' });
  assert.equal((await call(s.w2, 'GET', '/api/me')).status, 401);
});
