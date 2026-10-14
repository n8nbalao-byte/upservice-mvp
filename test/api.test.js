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
// Selfie de celular real (~400 KB): pega limites de corpo de requisição baixos demais.
const BIG_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400 * 1024)]).toString('base64');

let server, base, q, closeDb, sweep;
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

async function approvedSession(worker, title) {
  const starts = new Date(Date.now() + 3600e3);
  const job = (await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title, startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 1, dailyValue: 100, breakCount: 1, breakMinutes: 15, publish: true,
  })).body.id;
  assert.equal((await call(worker, 'POST', `/api/jobs/${job}/apply`, {})).status, 201);
  const [app] = (await call(s.gestor, 'GET', `/api/manage/jobs/${job}/applications`)).body.applications;
  assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${app.id}/decide`, { decision: 'APROVADA' })).status, 200);
  const [ws] = await q('SELECT id FROM work_sessions WHERE application_id = ?', [app.id]);
  return { job, application: app.id, session: ws.id };
}

async function askException(cookie, sessionId, type, reason, extra = {}) {
  const token = (await call(cookie, 'POST', `/api/sessions/${sessionId}/token`, {})).body.token;
  return call(cookie, 'POST', `/api/sessions/${sessionId}/exceptions`, { type, token, reason, selfie: JPEG, errorMessage: 'GPS indisponível', message: 'Estou na loja', ...extra });
}

async function absent(worker, title) {
  const a = await approvedSession(worker, title);
  await q('UPDATE jobs SET starts_at = ?, ends_at = ? WHERE id = ?', [new Date(Date.now() - 3600e3), new Date(Date.now() + 7 * 3600e3), a.job]);
  return call(s.gestor, 'POST', `/api/manage/applications/${a.application}/confirm`, { result: 'NAO_COMPARECEU', note: 'Não apareceu' });
}

const userByEmail = async (email) => (await q('SELECT id, status FROM users WHERE email = ?', [email]))[0];

const sessionStatus = async (id) => (await q('SELECT status FROM work_sessions WHERE id = ?', [id]))[0].status;

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
  ({ sweep } = await import('../server/routes/presence.js'));
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
  await sweep();
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

test('exceção de GPS: bloqueia novos registros, recusa volta, aprovação grava EXCECAO_APROVADA', { skip }, async () => {
  const { session } = await approvedSession(s.w1, 'Exceção GPS');
  const asked = await askException(s.w1, session, 'CHECK_IN', 'FORA_DO_RAIO', { lat: -23.56, lng: -46.63, accuracy: 20 });
  assert.equal(asked.status, 201);
  assert.equal(await sessionStatus(session), 'PENDENTE_DE_EXCECAO');
  assert.equal((await event(s.w1, session, 'CHECK_IN')).status, 409, 'registro normal bloqueado enquanto pendente');
  assert.equal((await askException(s.w1, session, 'CHECK_IN', 'OUTRO')).status, 409, 'uma exceção por vez');
  assert.equal((await call(s.w1, 'POST', `/api/manage/exceptions/${asked.body.id}/decide`, { decision: 'APROVADA', reason: 'Tentando aprovar a própria' })).status, 403);
  assert.equal((await call(s.w2, 'GET', `/api/files/exception/${asked.body.id}`)).status, 404);
  assert.equal((await call(s.gestor, 'GET', `/api/files/exception/${asked.body.id}`)).status, 200);

  assert.equal((await call(s.gestor, 'POST', `/api/manage/exceptions/${asked.body.id}/decide`, { decision: 'RECUSADA', reason: 'Selfie sem rosto visível' })).status, 200);
  assert.equal(await sessionStatus(session), 'AGUARDANDO_CHECKIN', 'recusa devolve ao estado anterior');

  const again = await askException(s.w1, session, 'CHECK_IN', 'GPS_INDISPONIVEL');
  const [exc] = await q('SELECT requested_at FROM presence_exceptions WHERE id = ?', [again.body.id]);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/exceptions/${again.body.id}/decide`, { decision: 'APROVADA', reason: 'Confirmei com o encarregado da loja' })).status, 200);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/exceptions/${again.body.id}/decide`, { decision: 'APROVADA', reason: 'Confirmei com o encarregado da loja' })).status, 409);
  assert.equal(await sessionStatus(session), 'EM_ATIVIDADE');
  const [ev] = await q('SELECT validation, occurred_at FROM presence_events WHERE work_session_id = ?', [session]);
  assert.equal(ev.validation, 'EXCECAO_APROVADA', 'exceção nunca vira GPS validado');
  assert.equal(+ev.occurred_at, +exc.requested_at, 'horário oficial é o do pedido');
});

test('check-in atrasado só por exceção; chegar cedo não tem exceção', { skip }, async () => {
  const late = await approvedSession(s.w2, 'Atrasado');
  await q('UPDATE jobs SET starts_at = ?, ends_at = ? WHERE id = ?', [new Date(Date.now() - 30 * 60e3), new Date(Date.now() + 7 * 3600e3), late.job]);
  const normal = await event(s.w2, late.session, 'CHECK_IN');
  assert.equal(normal.status, 422);
  assert.match(normal.body.error, /15 minutos/);
  const asked = await askException(s.w2, late.session, 'CHECK_IN', 'FORA_DO_HORARIO', { ...UNIT, accuracy: 15 });
  assert.equal(asked.status, 201);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/exceptions/${asked.body.id}/decide`, { decision: 'APROVADA', reason: 'Atraso do ônibus, avisou o gestor' })).status, 200);
  assert.equal(await sessionStatus(late.session), 'EM_ATIVIDADE');
  s.lateSession = late;

  const early = await approvedSession(s.w1, 'Cedo');
  await q('UPDATE jobs SET starts_at = ? WHERE id = ?', [new Date(Date.now() + 3 * 3600e3), early.job]);
  assert.equal((await askException(s.w1, early.session, 'CHECK_IN', 'GPS_INDISPONIVEL')).status, 422);
});

test('checkout esquecido: lembrete, pendência após 30 min e fechamento administrativo', { skip }, async () => {
  const { session, job, application } = s.lateSession;
  assert.equal((await event(s.w2, session, 'PAUSE_START')).status, 200);
  // Leva os registros 2 h para trás, como numa jornada real.
  await q('UPDATE presence_events SET occurred_at = occurred_at - INTERVAL 2 HOUR WHERE work_session_id = ?', [session]);

  await q('UPDATE jobs SET starts_at = ?, ends_at = ? WHERE id = ?', [new Date(Date.now() - 9 * 3600e3), new Date(Date.now() - 10 * 60e3), job]);
  await sweep();
  const [ws] = await q('SELECT status, checkout_reminder_at FROM work_sessions WHERE id = ?', [session]);
  assert.ok(ws.checkout_reminder_at, 'lembrete enviado após o término');
  assert.notEqual(ws.status, 'PENDENTE_DE_FECHAMENTO', 'ainda dentro da tolerância de 30 min');

  await q('UPDATE jobs SET ends_at = ? WHERE id = ?', [new Date(Date.now() - 31 * 60e3), job]);
  await sweep();
  assert.equal(await sessionStatus(session), 'PENDENTE_DE_FECHAMENTO');
  const [audited] = await q("SELECT 1 FROM audit_events WHERE action = 'CHECKOUT_AUSENTE' AND entity_id = ?", [session]);
  assert.ok(audited);
  assert.equal((await event(s.w2, session, 'CHECK_OUT')).status, 409, 'sem checkout falso depois da tolerância');

  const close = (body) => call(s.gestor, 'POST', `/api/manage/sessions/${session}/close`, { reason: 'Profissional esqueceu o checkout', ...body });
  assert.equal((await close({ source: 'INFORMADO_PROFISSIONAL' })).status, 409, 'profissional ainda não informou');
  const reported = new Date(Date.now() - 30 * 60e3);
  assert.equal((await call(s.w2, 'POST', `/api/me/sessions/${session}/reported-end`, { time: reported, note: 'Saí às pressas' })).status, 200);
  assert.equal((await close({ source: 'INFORMADO_PROFISSIONAL' })).status, 200);

  const detail = (await call(s.w2, 'GET', `/api/me/sessions/${session}`)).body;
  assert.equal(detail.session.status, 'FINALIZADA');
  const out = detail.events.at(-1);
  assert.equal(out.validation, 'FECHAMENTO_ADMINISTRATIVO');
  assert.equal(out.closure_source, 'INFORMADO_PROFISSIONAL');
  assert.equal(+new Date(out.occurred_at), +reported);
  assert.deepEqual(detail.worked.sources.sort(), ['EXCECAO_APROVADA', 'FECHAMENTO_ADMINISTRATIVO', 'GPS_VALIDADO']);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${application}/confirm`, { result: 'CONCLUIDA' })).status, 200);
});

test('selfie de tamanho real passa no registro e no pedido de exceção', { skip }, async () => {
  const { session } = await approvedSession(s.w1, 'Selfie grande');
  const asked = await askException(s.w1, session, 'CHECK_IN', 'GPS_INDISPONIVEL', { selfie: BIG_JPEG });
  assert.equal(asked.status, 201, 'exceção com selfie de ~400 KB');
  const token = (await call(s.w1, 'POST', `/api/sessions/${session}/token`, {})).body.token;
  const big = await call(s.w1, 'POST', `/api/sessions/${session}/events`, { type: 'CHECK_IN', token, ...UNIT, accuracy: 20, selfie: BIG_JPEG });
  assert.notEqual(big.status, 413, 'registro com selfie de ~400 KB não estoura o limite');
});

test('3 faltas confirmadas: bloqueio de 15 dias, vaga futura liberada e modo restrito com contestação', { skip }, async () => {
  s.w5 = await login('w5@test.dev');
  await completeWorker(s.w5, '123.456.789-09');
  const future = await approvedSession(s.w5, 'Vaga futura');
  assert.equal((await absent(s.w5, 'Falta 1')).status, 200);
  assert.equal((await absent(s.w5, 'Falta 2')).status, 200);
  assert.equal((await userByEmail('w5@test.dev')).status, 'ATIVO', 'duas faltas ainda não bloqueiam');
  assert.equal((await absent(s.w5, 'Falta 3')).status, 200);

  const u = await userByEmail('w5@test.dev');
  s.w5Id = u.id;
  assert.equal(u.status, 'BLOQUEADO_TEMPORARIAMENTE');
  const [p] = await q("SELECT * FROM penalties WHERE user_id = ? AND status = 'ATIVA'", [u.id]);
  assert.equal(p.type, 'BLOQUEIO_TEMPORARIO');
  assert.equal(Math.round((p.ends_at - p.starts_at) / 86400e3), 15);
  const [linked] = await q('SELECT COUNT(*) AS n FROM occurrences WHERE penalty_id = ?', [p.id]);
  assert.equal(Number(linked.n), 3, 'as 3 faltas ficam vinculadas ao bloqueio');
  const [fa] = await q('SELECT status, cancel_reason FROM applications WHERE id = ?', [future.application]);
  assert.equal(fa.status, 'CANCELADA', 'vaga futura liberada');

  assert.equal((await call(s.w5, 'GET', '/api/me')).status, 200);
  assert.equal((await call(s.w5, 'GET', '/api/jobs')).status, 403, 'bloqueado não vê vagas');
  const mine = (await call(s.w5, 'GET', '/api/me/occurrences')).body;
  assert.equal(mine.occurrences.length, 3);
  assert.equal(mine.strikes, 0, 'contagem recomeça após o bloqueio');
  const contest = await call(s.w5, 'POST', '/api/me/contestations', { penaltyId: p.id, message: 'Estive doente, tenho atestado médico' });
  assert.equal(contest.status, 201);
  assert.match(contest.body.protocol, /^CT-\d{8}-[0-9A-F]{4}$/);
  assert.equal((await call(s.w5, 'POST', '/api/me/contestations', { penaltyId: p.id, message: 'De novo a mesma contestação' })).status, 409);
});

test('contestação aceita reativa; nova falta sozinha não bloqueia; bloqueio vencido reativa', { skip }, async () => {
  const inbox = (await call(s.gestor, 'GET', '/api/manage/inbox')).body.items.map((i) => i.kind);
  assert.ok(inbox.includes('CONTESTACAO') && inbox.includes('EXCECAO'), 'central de pendências mostra contestação e exceção');
  const [ct] = await q("SELECT id FROM contestations WHERE user_id = ? AND status = 'ABERTA'", [s.w5Id]);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/contestations/${ct.id}/decide`, { decision: 'CANCELADA', reason: 'Atestado médico apresentado' })).status, 200);
  assert.equal((await userByEmail('w5@test.dev')).status, 'ATIVO');

  assert.equal((await absent(s.w5, 'Falta 4')).status, 200);
  assert.equal((await userByEmail('w5@test.dev')).status, 'ATIVO', 'faltas já usadas num bloqueio não voltam a contar');

  assert.equal((await call(s.admin, 'PATCH', `/api/admin/users/${s.w5Id}`, { status: 'BLOQUEADO_TEMPORARIAMENTE', reason: 'Bloqueio manual para teste' })).status, 200);
  const [p] = await q("SELECT id FROM penalties WHERE user_id = ? AND status = 'ATIVA'", [s.w5Id]);
  assert.ok(p, 'bloqueio pelo admin também vira penalidade');
  await q('UPDATE penalties SET ends_at = ? WHERE id = ?', [new Date(Date.now() - 1000), p.id]);
  await sweep();
  assert.equal((await userByEmail('w5@test.dev')).status, 'ATIVO', 'reativação automática no fim do prazo');
});

test('bloqueio permanente exige confirmação digitada; gestor de outra loja não alcança', { skip }, async () => {
  const g2 = await login('gestor2@test.dev');
  const g2Id = (await userByEmail('gestor2@test.dev')).id;
  await call(s.admin, 'PATCH', `/api/admin/users/${g2Id}`, { role: 'GESTOR', reason: 'Gestor da loja B no piloto' });
  await call(s.admin, 'PUT', `/api/admin/users/${g2Id}/units`, { unitIds: [s.unitB] });

  const block = (who, body) => call(who, 'POST', `/api/manage/workers/${s.w5Id}/block`, { reason: 'Fraude comprovada no registro de presença', ...body });
  assert.equal((await block(s.gestor, {})).status, 400, 'sem digitar BLOQUEAR');
  assert.equal((await block(g2, { confirm: 'BLOQUEAR' })).status, 404, 'gestor sem vínculo com o profissional');
  assert.equal((await block(s.gestor, { confirm: 'BLOQUEAR' })).status, 200);
  assert.equal((await userByEmail('w5@test.dev')).status, 'BLOQUEADO_PERMANENTEMENTE');
  assert.equal((await block(s.gestor, { confirm: 'BLOQUEAR' })).status, 409);

  const [p] = await q("SELECT id FROM penalties WHERE user_id = ? AND type = 'BLOQUEIO_PERMANENTE' AND status = 'ATIVA'", [s.w5Id]);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/penalties/${p.id}/end`, { reason: 'Reavaliado com a operação' })).status, 200);
  assert.equal((await userByEmail('w5@test.dev')).status, 'ATIVO');
});

test('pausa excedida e checkout ausente viram ocorrência pendente, que o gestor confirma ou cancela', { skip }, async () => {
  const pending = await q("SELECT id, type, user_id FROM occurrences WHERE status = 'PENDENTE' ORDER BY type");
  assert.deepEqual([...new Set(pending.map((o) => o.type))], ['CHECKOUT_AUSENTE', 'PAUSA_EXCEDIDA']);
  const list = (await call(s.gestor, 'GET', '/api/manage/occurrences')).body;
  assert.ok(list.occurrences.length >= 2);
  const pause = pending.find((o) => o.type === 'PAUSA_EXCEDIDA');
  assert.equal((await call(s.gestor, 'POST', `/api/manage/occurrences/${pause.id}/decide`, { decision: 'CONFIRMADA', reason: 'Voltou 20 minutos atrasado' })).status, 200);
  const worker = (await q('SELECT status FROM users WHERE id = ?', [pause.user_id]))[0];
  assert.equal(worker.status, 'ATIVO', 'pausa excedida não conta como falta');
  assert.equal((await call(s.gestor, 'POST', '/api/manage/occurrences', { userId: pause.user_id, unitId: s.unitA, type: 'ABANDONO', description: 'Saiu no meio do turno sem avisar' })).status, 201);
  assert.equal((await call(s.gestor, 'POST', '/api/manage/occurrences', { userId: pause.user_id, unitId: s.unitA, type: 'FALTA', description: 'Falta só pela confirmação da diária' })).status, 400);
});

test('unidade bloqueada não recebe vagas; profissional bloqueado entra só em modo restrito', { skip }, async () => {
  assert.equal((await call(s.admin, 'POST', `/api/units/${s.unitA}/status`, { status: 'BLOQUEADA_FINANCEIRA', reason: 'Pagamento em atraso desde setembro' })).status, 200);
  const starts = new Date(Date.now() + 3600e3);
  const r = await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Repositor', startsAt: starts, endsAt: new Date(starts.getTime() + 3600e3), positions: 1, dailyValue: 100, breakCount: 0, breakMinutes: 15,
  });
  assert.equal(r.status, 409);

  const [u] = await q("SELECT id FROM users WHERE email = 'w2@test.dev'");
  await call(s.admin, 'PATCH', `/api/admin/users/${u.id}`, { status: 'BLOQUEADO_PERMANENTEMENTE', reason: 'Teste de bloqueio permanente' });
  const me = await call(s.w2, 'GET', '/api/me');
  assert.equal(me.status, 200, 'profissional bloqueado entra em modo restrito');
  assert.equal(me.body.user.status, 'BLOQUEADO_PERMANENTEMENTE');
  assert.equal((await call(s.w2, 'GET', '/api/jobs')).status, 403);
});
