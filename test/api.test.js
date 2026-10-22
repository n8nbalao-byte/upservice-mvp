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

/** Cadastro completo; por padrão a UpService (admin) já aprovou os documentos, o que habilita a aprovação automática. */
async function completeWorker(cookie, cpf, { approve = true } = {}) {
  assert.equal((await call(cookie, 'PUT', '/api/me/profile', {
    name: 'Fulano de Tal', cpf, rg: '123456789', phone: '11999990000', address: 'Rua A, 1', city: 'São Paulo', uf: 'SP',
    emergencyName: 'Ciclano', emergencyPhone: '11988880000', role: 'ADMINISTRADOR',
  })).status, 200);
  for (const type of ['CPF', 'RG', 'COMPROVANTE']) assert.equal((await call(cookie, 'POST', '/api/me/documents', { type, file: JPEG })).status, 200);
  assert.equal((await call(cookie, 'POST', '/api/me/terms', { accept: true })).body.complete, false, 'sem selfie o cadastro não fica completo');
  const pdf = Buffer.from('%PDF-1.4 teste').toString('base64');
  assert.equal((await call(cookie, 'POST', '/api/me/documents', { type: 'SELFIE', file: pdf })).status, 400, 'selfie não pode ser PDF');
  assert.equal((await call(cookie, 'POST', '/api/me/documents', { type: 'SELFIE', file: JPEG })).status, 200);
  const done = await call(cookie, 'POST', '/api/me/terms', { accept: true });
  assert.equal(done.body.complete, true);
  if (!approve) return;
  for (const d of done.body.documents) {
    assert.equal((await call(s.admin, 'POST', `/api/manage/documents/${d.id}/review`, { status: 'APROVADO' })).status, 200);
  }
}

async function event(cookie, sessionId, type, where = UNIT, token) {
  token ??= (await call(cookie, 'POST', `/api/sessions/${sessionId}/token`, {})).body.token;
  return call(cookie, 'POST', `/api/sessions/${sessionId}/events`, { type, token, ...where, accuracy: 20, clientTs: new Date().toISOString(), selfie: JPEG });
}

async function approvedSession(worker, title, { startsIn = 10 * 60e3 } = {}) {
  // Os testes reaproveitam o mesmo horário (próximas horas): encerra as diárias em aberto deste profissional nessa faixa,
  // senão a regra de conflito de horário recusa. Vagas de outros dias ficam intactas.
  const me = (await call(worker, 'GET', '/api/me')).body.user.id;
  await q(`UPDATE work_sessions ws JOIN applications a ON a.id = ws.application_id JOIN jobs j ON j.id = a.job_id SET ws.status = 'FINALIZADA'
           WHERE a.user_id = ? AND j.starts_at < ? AND ws.status NOT IN ('FINALIZADA', 'CANCELADA_ADMINISTRATIVAMENTE')`, [me, new Date(Date.now() + 86400e3)]);
  const starts = new Date(Date.now() + startsIn);
  const job = (await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title, startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 1, dailyValue: 100, breakCount: 1, breakMinutes: 15, publish: true,
  })).body.id;
  const applied = await call(worker, 'POST', `/api/jobs/${job}/apply`, {});
  assert.equal(applied.status, 201);
  assert.equal(applied.body.status, 'APROVADA', 'aprovação automática');
  const app = { id: applied.body.id };
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

test('candidaturas simultâneas: uma aprovada na hora, a outra na reserva', { skip }, async () => {
  const starts = new Date(Date.now() + 10 * 60e3); // dentro da janela de check-in (15 min antes)
  const created = await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Repositor', startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 1, dailyValue: 150.5, breakCount: 1, breakMinutes: 15, publish: true,
  });
  assert.equal(created.status, 201);
  s.job = created.body.id;

  const jobs = (await call(s.w1, 'GET', `/api/jobs?lat=${UNIT.lat}&lng=${UNIT.lng}`)).body;
  assert.equal(jobs[0].id, s.job);
  assert.equal(jobs[0].distance_m, 0);
  const both = await Promise.all([s.w1, s.w2].map((w) => call(w, 'POST', `/api/jobs/${s.job}/apply`, {})));
  assert.deepEqual(both.map((r) => r.status), [201, 201]);
  assert.deepEqual(both.map((r) => r.body.status).sort(), ['APROVADA', 'RESERVA'], '1 posição: uma aprovada, outra na reserva');
  assert.equal(both.find((r) => r.body.status === 'RESERVA').body.position, 1);
  assert.equal((await call(s.w1, 'POST', `/api/jobs/${s.job}/apply`, {})).status, 409, 'candidatura duplicada');
  const inbox = (await call(s.gestor, 'GET', '/api/manage/inbox')).body.items;
  assert.ok(!inbox.some((i) => i.kind === 'CANDIDATURA'), 'candidatura não vira pendência do gestor');

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

test('saída antecipada não confirma sozinha; o gestor confirma e soma no valor a receber', { skip }, async () => {
  const [auto] = await q('SELECT 1 FROM daily_confirmations WHERE application_id = ?', [s.application]);
  assert.equal(auto, undefined, 'checkout logo depois do check-in não vira diária paga sozinho');
  assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${s.application}/confirm`, { result: 'CONCLUIDA' })).status, 200);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${s.application}/confirm`, { result: 'CONCLUIDA' })).status, 409, 'já confirmada');
  const summary = (await call(s.winner, 'GET', '/api/me/summary')).body;
  assert.equal(summary.concluidas, 1);
  assert.equal(summary.valor, 150.5);
});

test('fila de documentos pendentes respeita o escopo do gestor', { skip }, async () => {
  const w4 = await login('w4@test.dev');
  await completeWorker(w4, '935.411.347-80', { approve: false }); // documentos enviados, sem candidatura
  const ids = async (who) => (await call(who, 'GET', '/api/manage/documents/pending')).body.map((r) => r.email);
  assert.ok((await ids(s.admin)).includes('w4@test.dev'));
  assert.ok(!(await ids(s.gestor)).includes('w4@test.dev'), 'gestor não vê quem não se candidatou nas suas lojas');
  const starts = new Date(Date.now() + 5 * 3600e3);
  const job = (await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Documento pendente', startsAt: starts, endsAt: new Date(starts.getTime() + 4 * 3600e3), positions: 3, dailyValue: 100, breakCount: 0, breakMinutes: 15, publish: true,
  })).body.id;
  const blocked = await call(w4, 'POST', `/api/jobs/${job}/apply`, {});
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /documentos estão em análise/);
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
  const future = await approvedSession(s.w5, 'Vaga futura', { startsIn: 3 * 86400e3 });
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

  // Uma contestação por ocorrência: decidida (mantida), não se contesta de novo.
  const [occ] = await q("SELECT id FROM occurrences WHERE user_id = ? AND status = 'CONFIRMADA' LIMIT 1", [s.w5Id]);
  assert.equal((await call(s.w5, 'POST', '/api/me/contestations', { occurrenceId: occ.id, message: 'Eu estava presente na loja nesse dia' })).status, 201);
  const [ct2] = await q('SELECT id FROM contestations WHERE occurrence_id = ?', [occ.id]);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/contestations/${ct2.id}/decide`, { decision: 'MANTIDA', reason: 'Registro confirmado pela loja' })).status, 200);
  const again = await call(s.w5, 'POST', '/api/me/contestations', { occurrenceId: occ.id, message: 'Quero contestar mais uma vez' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já foi contestada/);

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

test('gestor não reverte bloqueio do admin nem decide contestação de ocorrência de outra loja', { skip }, async () => {
  const w1 = await userByEmail('w1@test.dev');
  const g2 = await login('gestor2@test.dev');
  // gestor da loja B passa a ter relação com w1 (candidatura numa vaga da loja B)
  const starts = new Date(Date.now() + 2 * 86400e3); // outro dia: não conflita com diárias em aberto do w1
  const job = (await call(g2, 'POST', '/api/manage/jobs', {
    unitId: s.unitB, title: 'Loja B', startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 1, dailyValue: 100, breakCount: 0, breakMinutes: 15, publish: true,
  })).body.id;
  assert.equal((await call(s.w1, 'POST', `/api/jobs/${job}/apply`, {})).status, 201);

  assert.equal((await call(s.gestor, 'POST', '/api/manage/occurrences', { userId: w1.id, unitId: s.unitA, type: 'REGRA_OPERACIONAL', description: 'Uso de celular na área de vendas' })).status, 201);
  const [occ] = await q("SELECT id FROM occurrences WHERE user_id = ? AND type = 'REGRA_OPERACIONAL'", [w1.id]);
  assert.equal((await call(s.w1, 'POST', '/api/me/contestations', { occurrenceId: occ.id, message: 'Estava falando com o encarregado da loja' })).status, 201);
  const [ct] = await q('SELECT id FROM contestations WHERE occurrence_id = ?', [occ.id]);
  assert.equal((await call(g2, 'POST', `/api/manage/contestations/${ct.id}/decide`, { decision: 'CANCELADA', reason: 'Decidindo ocorrência de outra loja' })).status, 404, 'gestor da loja B não decide ocorrência da loja A');
  assert.equal((await call(s.gestor, 'POST', `/api/manage/contestations/${ct.id}/decide`, { decision: 'MANTIDA', reason: 'Regra informada no treinamento' })).status, 200);

  assert.equal((await call(s.admin, 'POST', `/api/manage/workers/${w1.id}/block`, { reason: 'Fraude confirmada pela auditoria', confirm: 'BLOQUEAR' })).status, 200);
  const [p] = await q("SELECT id FROM penalties WHERE user_id = ? AND status = 'ATIVA'", [w1.id]);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/penalties/${p.id}/end`, { reason: 'Tentando reverter bloqueio do admin' })).status, 403, 'gestor não reverte bloqueio aplicado pelo admin');
  assert.equal((await call(s.admin, 'POST', `/api/manage/penalties/${p.id}/end`, { reason: 'Revisado pela diretoria' })).status, 200);
  assert.equal((await userByEmail('w1@test.dev')).status, 'ATIVO');
});

test('monitoramento: ping dentro só atualiza; fora do raio em atividade alerta uma vez; pausa não alerta', { skip }, async () => {
  const FAR = { lat: -23.56, lng: -46.63 };
  const m = await approvedSession(s.w1, 'Monitorada');
  assert.equal((await event(s.w1, m.session, 'CHECK_IN')).status, 200);
  const ping = (who, where) => call(who, 'POST', `/api/sessions/${m.session}/ping`, { ...where, accuracy: 20 });
  // A rota ignora leituras com menos de 60 s; o teste "envelhece" a última leitura.
  const age = () => q('UPDATE work_sessions SET last_ping_at = ? WHERE id = ?', [new Date(Date.now() - 120e3), m.session]);
  const alertCount = async () => Number((await q('SELECT COUNT(*) AS n FROM location_alerts WHERE work_session_id = ?', [m.session]))[0].n);

  let r = await ping(s.w1, UNIT);
  assert.deepEqual([r.status, r.body.inside, r.body.alert], [200, true, false]);
  assert.equal((await ping(s.w1, FAR)).body.ignored, true, 'menos de 60 s da leitura anterior');
  await age();
  r = await ping(s.w1, FAR);
  assert.deepEqual([r.body.inside, r.body.alert], [false, true]);
  await age();
  assert.equal((await ping(s.w1, FAR)).body.alert, false, 'um alerta a cada 30 min');
  assert.equal(await alertCount(), 1);
  assert.equal((await ping(s.w5, FAR)).status, 404, 'outro profissional');

  const inbox = (await call(s.gestor, 'GET', '/api/manage/inbox')).body.items;
  const item = inbox.find((i) => i.kind === 'SAIDA_DO_RAIO');
  assert.ok(item, 'saída do raio aparece na central de pendências');
  const [alert] = await q('SELECT id FROM location_alerts WHERE work_session_id = ?', [m.session]);
  const g2 = await login('gestor2@test.dev');
  assert.equal((await call(g2, 'POST', `/api/manage/location-alerts/${alert.id}/ack`, {})).status, 404, 'gestor de outra loja');
  assert.equal((await call(s.gestor, 'POST', `/api/manage/location-alerts/${alert.id}/ack`, {})).status, 200);
  assert.ok(!(await call(s.gestor, 'GET', '/api/manage/inbox')).body.items.some((i) => i.kind === 'SAIDA_DO_RAIO'), 'ciente tira da central');

  // Na pausa a pessoa pode sair da loja: sem alerta.
  assert.equal((await event(s.w1, m.session, 'PAUSE_START')).status, 200);
  await q('UPDATE location_alerts SET at = ? WHERE work_session_id = ?', [new Date(Date.now() - 31 * 60e3), m.session]);
  await age();
  assert.equal((await ping(s.w1, FAR)).body.alert, false);
  assert.equal(await alertCount(), 1);

  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const panel = (await call(s.gestor, 'GET', `/api/manage/sessions?unitId=${s.unitA}&date=${day}`)).body.sessions.find((x) => x.id === m.session);
  assert.ok(panel?.last_ping_at, 'painel mostra a última leitura');
  assert.equal(panel.alerts.length, 1);
});

test('relatório: indicadores batem com o banco, horas gravadas no fechamento, escopo e limite de período', { skip }, async () => {
  const day = (offset) => new Date(Date.now() + offset * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const from = day(-1);
  const to = day(1);
  const [fin] = await q("SELECT worked_min, sources FROM work_sessions WHERE id = ?", [s.session]);
  assert.ok(fin.worked_min != null && fin.sources === 'GPS_VALIDADO', 'horas gravadas quando a jornada finaliza');

  const rep = await call(s.admin, 'GET', `/api/manage/reports?from=${from}&to=${to}`);
  assert.equal(rep.status, 200);
  const ind = rep.body.indicators;
  const [db] = await q(`SELECT SUM(result = 'CONCLUIDA') AS concluded, SUM(result = 'NAO_COMPARECEU') AS absences FROM daily_confirmations`);
  assert.equal(ind.concluded, Number(db.concluded));
  assert.equal(ind.absences, Number(db.absences));
  const [hours] = await q(`SELECT COALESCE(SUM(ws.worked_min), 0) AS m FROM work_sessions ws JOIN applications a ON a.id = ws.application_id WHERE a.status = 'APROVADA' AND ws.status = 'FINALIZADA'`);
  assert.equal(ind.workedMin, Number(hours.m), 'horas = soma das jornadas finalizadas');
  assert.ok(ind.sources.GPS_VALIDADO > 0 && ind.sources.EXCECAO_APROVADA > 0 && ind.sources.FECHAMENTO_ADMINISTRATIVO > 0, 'registros por origem');
  assert.ok(ind.exceptions.APROVADA > 0 && ind.exceptions.RECUSADA > 0);
  assert.ok(ind.occurrences.FALTA >= 4);
  assert.equal(ind.locationAlerts, 1);
  assert.equal(rep.body.byUnit.reduce((t, u) => t + u.approved, 0), ind.approved);

  const g2 = await login('gestor2@test.dev');
  assert.equal((await call(g2, 'GET', `/api/manage/reports?from=${from}&to=${to}&unitId=${s.unitA}`)).status, 404, 'gestor B não vê loja A');
  const mine = (await call(g2, 'GET', `/api/manage/reports?from=${from}&to=${to}`)).body;
  assert.ok(mine.byUnit.every((u) => u.unitId === s.unitB), 'gestor vê só as lojas dele');
  assert.equal((await call(s.admin, 'GET', `/api/manage/reports?from=${day(-40)}&to=${to}`)).status, 400, 'máximo de 31 dias');
  // Valores de diária só para o administrador: o gestor recebe o relatório sem R$ (total, por loja e por linha).
  assert.equal(rep.body.money, true);
  assert.equal(typeof ind.value, 'number');
  const gest = (await call(s.gestor, 'GET', `/api/manage/reports?from=${from}&to=${to}`)).body;
  assert.equal(gest.money, false);
  assert.ok(!('value' in gest.indicators) && gest.byUnit.every((u) => !('value' in u)) && gest.rows.every((x) => !('daily_value' in x)), 'gestor sem valores');
  const csv = await (await fetch(`${base}/api/manage/reports/export.csv?from=${from}&to=${to}`, { headers: { cookie: s.gestor } })).text();
  assert.ok(!csv.includes('valor_diaria'), 'CSV do gestor sem a coluna de valor');
});

test('CSV: BOM, separador, fórmula neutralizada, auditoria e escopo', { skip }, async () => {
  const day = (offset) => new Date(Date.now() + offset * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const qs = `from=${day(-1)}&to=${day(1)}`;
  const w1 = await userByEmail('w1@test.dev');
  const [{ name }] = await q('SELECT name FROM users WHERE id = ?', [w1.id]);
  await q('UPDATE users SET name = ? WHERE id = ?', ['=HYPERLINK("http://x")', w1.id]);
  try {
    const res = await fetch(`${base}/api/manage/reports/export.csv?${qs}`, { headers: { cookie: s.admin } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    // res.text() descarta o BOM; o Excel lê os bytes crus.
    const raw = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para o Excel');
    const body = raw.subarray(3).toString('utf8');
    assert.ok(body.startsWith('"unidade_codigo";"unidade_nome";"data_vaga"'), 'cabeçalho com ;');
    assert.ok(body.includes('"\'=HYPERLINK(""http://x"")"'), 'fórmula neutralizada');
    assert.ok(!body.includes('@test.dev'), 'sem e-mail no arquivo');
    const lines = body.trim().split('\r\n');
    const rep = (await call(s.admin, 'GET', `/api/manage/reports?${qs}`)).body;
    assert.equal(lines.length, rep.totalRows + 1);
  } finally {
    await q('UPDATE users SET name = ? WHERE id = ?', [name, w1.id]);
  }
  const [audited] = await q("SELECT after_json FROM audit_events WHERE action = 'REPORT_EXPORT' ORDER BY created_at DESC LIMIT 1");
  assert.match(audited.after_json, /"rows":\d+/);
  const g2 = await login('gestor2@test.dev');
  assert.equal((await fetch(`${base}/api/manage/reports/export.csv?${qs}&unitId=${s.unitA}`, { headers: { cookie: g2 } })).status, 404);
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

test('dashboard e busca respeitam o escopo do gestor', { skip }, async () => {
  const starts = new Date(Date.now() + 86400e3);
  assert.equal((await call(s.admin, 'POST', '/api/manage/jobs', {
    unitId: s.unitB, title: 'Vigia noturno', startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 2, dailyValue: 150, breakCount: 1, breakMinutes: 15, publish: true,
  })).status, 201);
  assert.equal((await call(s.w1, 'GET', '/api/manage/dashboard')).status, 403);
  assert.equal((await call(s.w1, 'GET', '/api/manage/search?q=Vigia')).status, 403);

  const admin = (await call(s.admin, 'GET', '/api/manage/dashboard')).body;
  const gestor = (await call(s.gestor, 'GET', '/api/manage/dashboard')).body;
  assert.ok(admin.latestJobs.some((j) => j.title === 'Vigia noturno'));
  assert.ok(!gestor.latestJobs.some((j) => j.unit_name === 'Loja B'), 'gestor não vê vaga de loja sem vínculo');
  assert.ok(admin.openJobs.jobs > gestor.openJobs.jobs);

  assert.equal((await call(s.admin, 'GET', '/api/manage/search?q=Vigia')).body.jobs.length, 1);
  const found = (await call(s.gestor, 'GET', '/api/manage/search?q=Loja')).body;
  assert.deepEqual(found.units.map((u) => u.name), ['Loja A']);
  assert.equal((await call(s.gestor, 'GET', '/api/manage/search?q=Vigia')).body.jobs.length, 0);
  assert.equal((await call(s.gestor, 'GET', '/api/manage/search?q=%25%25')).body.jobs.length, 0, 'curinga do LIKE é escapado');
});

test('API nunca em cache e WhatsApp do suporte só com dígitos', { skip }, async () => {
  delete process.env.SUPPORT_WHATSAPP;
  const before = await call(null, 'GET', '/api/config');
  assert.equal(before.res.headers.get('cache-control'), 'no-store');
  assert.equal(before.body.supportWhatsapp, '5511926746277', 'sem variável: WhatsApp oficial da UP Service');
  process.env.SUPPORT_WHATSAPP = '+55 (11) 99999-0000';
  assert.equal((await call(null, 'GET', '/api/config')).body.supportWhatsapp, '5511999990000');
  delete process.env.SUPPORT_WHATSAPP;
  assert.equal((await call(s.admin, 'GET', '/api/admin/users')).res.headers.get('cache-control'), 'no-store');
});

test('reserva: chamada sozinha quando o gestor cancela ou o profissional desiste; desistência só até 2 h antes', { skip }, async () => {
  // O teste anterior deixa a loja A bloqueada (financeiro).
  assert.equal((await call(s.admin, 'POST', `/api/units/${s.unitA}/status`, { status: 'ATIVA', reason: 'Pagamento regularizado em outubro' })).status, 200);
  const workers = [];
  for (const [i, cpf] of [['r1', '714.602.890-99'], ['r2', '432.143.870-57'], ['r3', '867.256.740-46']]) {
    const c = await login(`${i}@test.dev`);
    await completeWorker(c, cpf);
    workers.push(c);
  }
  const [r1, r2, r3] = workers;
  const mk = async (startsIn) => (await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: `Reserva ${startsIn}`, startsAt: new Date(Date.now() + startsIn), endsAt: new Date(Date.now() + startsIn + 4 * 3600e3), positions: 1, dailyValue: 120, breakCount: 0, breakMinutes: 15, publish: true,
  })).body.id;
  const job = await mk(4 * 86400e3);
  const apply = (c) => call(c, 'POST', `/api/jobs/${job}/apply`, {}).then((r) => r.body);
  const a1 = await apply(r1);
  const a2 = await apply(r2);
  const a3 = await apply(r3);
  assert.deepEqual([a1.status, a2.status, a3.status], ['APROVADA', 'RESERVA', 'RESERVA']);
  assert.deepEqual([a2.position, a3.position], [1, 2]);
  const mine = (await call(r3, 'GET', '/api/me/applications')).body.find((a) => a.id === a3.id);
  assert.equal(Number(mine.reserve_position), 2);

  // Gestor cancela o aprovado: o 1º da reserva é aprovado e ganha a jornada (check-in liberado).
  assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${a1.id}/cancel`, { reason: 'Escala alterada pela loja' })).status, 200);
  const status = async (id) => (await q('SELECT status FROM applications WHERE id = ?', [id]))[0].status;
  assert.equal(await status(a2.id), 'APROVADA', 'reserva promovida');
  assert.equal((await q('SELECT COUNT(*) AS n FROM work_sessions WHERE application_id = ?', [a2.id]))[0].n, 1);
  assert.equal(await status(a3.id), 'PENDENTE');

  // Profissional aprovado desiste com antecedência: o próximo da reserva entra.
  assert.equal((await call(r2, 'POST', `/api/me/applications/${a2.id}/cancel`, {})).status, 200);
  assert.equal(await status(a3.id), 'APROVADA');
  assert.equal((await q('SELECT status FROM work_sessions WHERE application_id = ?', [a2.id]))[0].status, 'CANCELADA_ADMINISTRATIVAMENTE');

  // Menos de 2 h para o início: desistência só falando com a loja.
  const soon = await mk(3600e3);
  const late = (await call(r1, 'POST', `/api/jobs/${soon}/apply`, {})).body;
  assert.equal(late.status, 'APROVADA');
  assert.equal((await call(r1, 'POST', `/api/me/applications/${late.id}/cancel`, {})).status, 409);

  // Conflito de horário: r1 já tem diária aprovada nesse horário.
  const clash = await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Mesmo horário', startsAt: new Date(Date.now() + 2 * 3600e3), endsAt: new Date(Date.now() + 6 * 3600e3), positions: 5, dailyValue: 120, breakCount: 0, breakMinutes: 15, publish: true,
  });
  const dup = await call(r1, 'POST', `/api/jobs/${clash.body.id}/apply`, {});
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /diária aprovada nesse horário/);
});

test('fechamento administrativo não confirma a diária sozinho', { skip }, async () => {
  const [n] = await q(`SELECT COUNT(*) AS n FROM work_sessions ws JOIN presence_events e ON e.work_session_id = ws.id AND e.validation = 'FECHAMENTO_ADMINISTRATIVO'
                       JOIN daily_confirmations dc ON dc.application_id = ws.application_id AND dc.confirmed_by IS NULL`);
  assert.equal(Number(n.n), 0);
});

test('loja: nº da filial único e telefone', { skip }, async () => {
  const base = { ...ADDR, ...UNIT, name: 'Loja Filial', phone: '(11) 3859-1455' };
  const created = await call(s.admin, 'POST', '/api/units', { ...base, filial: '0937' });
  assert.equal(created.status, 201);
  const [u] = await q('SELECT filial, phone FROM units WHERE id = ?', [created.body.id]);
  assert.deepEqual({ ...u }, { filial: '937', phone: '(11) 3859-1455' }, 'filial só com dígitos, sem zero à esquerda');
  const again = await call(s.admin, 'POST', '/api/units', { ...base, name: 'Outra', filial: '937' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /Filial 937 já cadastrada em ATC-/);
  assert.equal((await call(s.admin, 'PUT', `/api/units/${created.body.id}`, { ...base, filial: '937' })).status, 200, 'a própria loja pode manter a filial');
  assert.equal((await call(s.gestor, 'POST', '/api/units', { ...base, filial: '1' })).status, 403);
});

test('checkout que cobre a jornada confirma a diária sozinho', { skip }, async () => {
  const c = await login('jornada@test.dev');
  await completeWorker(c, '248.135.790-60');
  const { job, session, application } = await approvedSession(c, 'Jornada completa');
  assert.equal((await event(c, session, 'CHECK_IN')).status, 200);
  // Simula as 8 h trabalhadas: vaga e check-in deslocados para o passado.
  await q('UPDATE jobs SET starts_at = ?, ends_at = ? WHERE id = ?', [new Date(Date.now() - 8 * 3600e3), new Date(Date.now() - 60e3), job]);
  await q("UPDATE presence_events SET occurred_at = ? WHERE work_session_id = ? AND type = 'CHECK_IN'", [new Date(Date.now() - 8 * 3600e3), session]);
  assert.equal((await event(c, session, 'CHECK_OUT')).status, 200);
  const [dc] = await q('SELECT result, confirmed_by FROM daily_confirmations WHERE application_id = ?', [application]);
  assert.equal(dc.result, 'CONCLUIDA');
  assert.equal(dc.confirmed_by, null, 'confirmada automaticamente');
  assert.equal((await call(c, 'GET', '/api/me/summary')).body.concluidas, 1);
});

test('gestor não aprova à mão da reserva quem perdeu a habilitação', { skip }, async () => {
  const a = await login('habil-a@test.dev');
  const b = await login('habil-b@test.dev');
  await completeWorker(a, '369.258.147-55');
  await completeWorker(b, '581.470.369-57');
  const starts = new Date(Date.now() + 5 * 86400e3);
  const job = (await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Habilitação', startsAt: starts, endsAt: new Date(starts.getTime() + 4 * 3600e3), positions: 1, dailyValue: 100, breakCount: 0, breakMinutes: 15, publish: true,
  })).body.id;
  assert.equal((await call(a, 'POST', `/api/jobs/${job}/apply`, {})).body.status, 'APROVADA');
  const reserve = (await call(b, 'POST', `/api/jobs/${job}/apply`, {})).body;
  assert.equal(reserve.status, 'RESERVA');
  const bId = (await call(b, 'GET', '/api/me')).body.user.id;
  await q("UPDATE worker_documents SET status = 'REJEITADO' WHERE user_id = ? AND type = 'RG'", [bId]);
  const manual = await call(s.gestor, 'POST', `/api/manage/applications/${reserve.id}/decide`, { decision: 'APROVADA' });
  assert.equal(manual.status, 409);
  assert.match(manual.body.error, /documentos/);
});

test('importar escala: prévia sem gravar, filial desconhecida, escopo do gestor, repetida, dia passado e vaga existente', { skip }, async () => {
  await q("UPDATE units SET filial = '9001' WHERE id = ?", [s.unitA]);
  await q("UPDATE units SET filial = '9002' WHERE id = ?", [s.unitB]);
  const day = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const defaults = { title: 'Repositor escala', startTime: '08:00', endTime: '16:00', dailyValue: 130, breakCount: 1, breakMinutes: 15, publish: true };
  const items = [
    { filial: '9001', name: 'LOJA A', date: day(10), positions: 15 },
    { filial: '9001', name: 'LOJA A', date: day(11), positions: 20 },
    { filial: '9001', name: 'LOJA A', date: day(11), positions: 20 }, // repetida
    { filial: '9001', name: 'LOJA A', date: day(-2), positions: 10 }, // já passou
    { filial: '09002', name: 'LOJA B', date: day(10), positions: 5 }, // fora do acesso do gestor
    { filial: '777', name: 'DESCONHECIDA', date: day(10), positions: 5 },
  ];
  const before = (await q('SELECT COUNT(*) AS n FROM jobs'))[0].n;
  const preview = await call(s.gestor, 'POST', '/api/manage/jobs/import', { defaults, items, dryRun: true });
  assert.equal(preview.status, 200);
  assert.equal((await q('SELECT COUNT(*) AS n FROM jobs'))[0].n, before, 'prévia não grava');
  assert.deepEqual(preview.body.summary, { lines: 6, jobs: 2, positions: 35, issues: { REPETIDA: 1, DATA_PASSADA: 1, FILIAL_DESCONHECIDA: 2 } });
  assert.equal(preview.body.stores.find((x) => x.filial === '777').unit, null);
  assert.equal(preview.body.stores.find((x) => x.filial === '9002').unit, null, 'loja fora do acesso não revela código nem nome');
  assert.ok(!JSON.stringify(preview.body).includes('Loja B'));

  const done = await call(s.gestor, 'POST', '/api/manage/jobs/import', { defaults, items });
  assert.equal(done.body.created, 2);
  const created = await q("SELECT positions, status, daily_value, starts_at, ends_at FROM jobs WHERE title = 'Repositor escala' ORDER BY starts_at");
  assert.deepEqual(created.map((j) => [j.positions, j.status, Number(j.daily_value)]), [[15, 'ABERTA', 130], [20, 'ABERTA', 130]]);
  assert.equal((new Date(created[0].ends_at) - new Date(created[0].starts_at)) / 3600e3, 8);
  assert.equal(new Date(created[0].starts_at).toISOString().slice(11, 16), '11:00', '08:00 em São Paulo');
  const [audited] = await q("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'JOBS_IMPORT'");
  assert.equal(Number(audited.n), 1);

  const again = await call(s.gestor, 'POST', '/api/manage/jobs/import', { defaults, items: items.slice(0, 2), dryRun: true });
  assert.deepEqual(again.body.summary.issues, { JA_EXISTE: 2 }, 'importar de novo não duplica');
  const admin = await call(s.admin, 'POST', '/api/manage/jobs/import', { defaults: { ...defaults, startTime: '22:00', endTime: '06:00' }, items: [items[4]], dryRun: true });
  assert.equal(admin.body.summary.jobs, 1, 'admin alcança a loja B; turno da noite termina no dia seguinte');
  assert.equal((await call(s.w1, 'POST', '/api/manage/jobs/import', { defaults, items, dryRun: true })).status, 403);
  assert.equal((await call(s.gestor, 'POST', '/api/manage/jobs/import', { defaults: { ...defaults, startTime: '8h' }, items })).status, 400);
});

test('check-in só a partir de 15 min antes do início', { skip }, async () => {
  const c = await login('cedo15@test.dev');
  await completeWorker(c, '159.357.258-19');
  const early = await approvedSession(c, 'Cedo demais', { startsIn: 20 * 60e3 });
  const r = await event(c, early.session, 'CHECK_IN');
  assert.ok(r.status >= 400);
  assert.match(r.body.error, /15 minutos antes/);
  const ok = await approvedSession(c, 'Na janela', { startsIn: 14 * 60e3 });
  assert.equal((await event(c, ok.session, 'CHECK_IN')).status, 200);
});

test('calendário: período, escopo do gestor e contagens', { skip }, async () => {
  const day = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const g = (who, qs) => call(who, 'GET', `/api/manage/calendar?${qs}`);
  const range = `from=${day(0)}&to=${day(30)}`;
  const admin = (await g(s.admin, range)).body;
  const gestor = (await g(s.gestor, range)).body;
  assert.ok(admin.jobs.length > gestor.jobs.length, 'admin vê também a loja B');
  assert.ok(gestor.jobs.length > 0);
  assert.ok(gestor.jobs.every((j) => j.unit_id === s.unitA), 'gestor só vê as lojas dele');
  const imported = gestor.jobs.filter((j) => j.title === 'Repositor escala');
  assert.deepEqual(imported.map((j) => [j.positions, typeof j.approved, typeof j.reserve]), [[15, 'number', 'number'], [20, 'number', 'number']]);
  assert.equal((await g(s.gestor, `${range}&unitId=${s.unitB}`)).status, 404, 'loja de outro gestor: 404');
  assert.equal((await g(s.gestor, `${range}&unitId=${s.unitA}`)).body.jobs.length, gestor.jobs.length);
  assert.equal((await g(s.w1, range)).status, 403);
  assert.equal((await g(s.gestor, `from=${day(0)}&to=${day(50)}`)).status, 400, 'mais de 42 dias');
  assert.equal((await g(s.gestor, 'from=ontem&to=hoje')).status, 400);
});

test('administrador principal: só ele exclui usuários e dá/tira papel de admin; ninguém altera o principal', { skip }, async () => {
  const a2 = await login('admin2@test.dev');
  await q("UPDATE users SET role = 'ADMINISTRADOR' WHERE email = 'admin2@test.dev'");
  const novo = await login('semhistorico@test.dev');
  const novoId = (await userByEmail('semhistorico@test.dev')).id;
  assert.equal((await call(a2, 'DELETE', `/api/admin/users/${novoId}`, { reason: 'Conta de teste duplicada' })).status, 403, 'admin comum não exclui');

  await q("UPDATE users SET is_owner = 1 WHERE email = 'admin@test.dev'");
  const owner = (await call(s.admin, 'GET', '/api/me')).body.user;
  assert.equal(owner.isOwner, true);
  assert.equal((await call(s.admin, 'DELETE', `/api/admin/users/${owner.id}`, { reason: 'Tentando excluir a si mesmo' })).status, 403);
  assert.equal((await call(s.admin, 'DELETE', `/api/admin/users/${novoId}`, {})).status, 400, 'justificativa obrigatória');

  // Sem histórico: apagado por completo.
  const gone = await call(s.admin, 'DELETE', `/api/admin/users/${novoId}`, { reason: 'Conta de teste duplicada' });
  assert.equal(gone.body.mode, 'APAGADO');
  assert.equal(await userByEmail('semhistorico@test.dev'), undefined);
  assert.equal((await call(novo, 'GET', '/api/me')).status, 401, 'sessão revogada');

  // Com histórico: anonimizado; vaga futura liberada e a reserva é chamada.
  const h = await login('comhistorico@test.dev');
  const r = await login('reserva-del@test.dev');
  await completeWorker(h, '274.185.963-91');
  await completeWorker(r, '396.174.258-82');
  const starts = new Date(Date.now() + 3 * 86400e3);
  const job = (await call(s.gestor, 'POST', '/api/manage/jobs', {
    unitId: s.unitA, title: 'Exclusão', startsAt: starts, endsAt: new Date(starts.getTime() + 4 * 3600e3), positions: 1, dailyValue: 100, breakCount: 0, breakMinutes: 15, publish: true,
  })).body.id;
  assert.equal((await call(h, 'POST', `/api/jobs/${job}/apply`, {})).body.status, 'APROVADA');
  const reserve = (await call(r, 'POST', `/api/jobs/${job}/apply`, {})).body;
  assert.equal(reserve.status, 'RESERVA');
  const hId = (await userByEmail('comhistorico@test.dev')).id;
  const del = await call(s.admin, 'DELETE', `/api/admin/users/${hId}`, { reason: 'Pedido do titular (LGPD)' });
  assert.deepEqual([del.body.mode, del.body.released], ['ANONIMIZADO', 1]);
  const [anon] = await q('SELECT name, email, google_sub, status, deleted_at FROM users WHERE id = ?', [hId]);
  assert.equal(anon.name, 'Usuário excluído');
  assert.match(anon.email, /^excluido\+.+@upservice\.invalid$/);
  assert.equal(anon.google_sub, null);
  assert.equal(anon.status, 'INATIVO');
  assert.ok(anon.deleted_at);
  for (const t of ['worker_profiles', 'worker_documents', 'sessions']) {
    assert.equal(Number((await q(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [hId]))[0].n), 0, `${t} apagado`);
  }
  assert.equal((await q('SELECT status FROM applications WHERE id = ?', [reserve.id]))[0].status, 'APROVADA', 'reserva promovida');
  assert.equal((await call(h, 'GET', '/api/me')).status, 401);
  assert.ok(!(await call(s.admin, 'GET', '/api/admin/users')).body.items.some((u) => u.id === hId), 'excluído some da lista');
  const [log] = await q("SELECT before_json, after_json FROM audit_events WHERE action = 'USER_DELETE' AND entity_id = ?", [hId]);
  assert.ok(!/comhistorico|274\.185/.test(log.before_json + log.after_json), 'auditoria sem dados pessoais');

  // Papel de admin: só o principal concede; ninguém altera o principal.
  const g = await login('promover@test.dev');
  const gId = (await userByEmail('promover@test.dev')).id;
  assert.equal((await call(a2, 'PATCH', `/api/admin/users/${gId}`, { role: 'ADMINISTRADOR', reason: 'Novo administrador da equipe' })).status, 403);
  assert.equal((await call(s.admin, 'PATCH', `/api/admin/users/${gId}`, { role: 'ADMINISTRADOR', reason: 'Novo administrador da equipe' })).status, 200);
  assert.equal((await call(a2, 'PATCH', `/api/admin/users/${owner.id}`, { status: 'INATIVO', reason: 'Tentando bloquear o principal' })).status, 403);
  assert.equal((await call(a2, 'PATCH', `/api/admin/users/${gId}`, { status: 'INATIVO', reason: 'Tirando o acesso de um colega' })).status, 403, 'admin comum não mexe em outro admin');
  assert.equal((await call(a2, 'PATCH', `/api/admin/users/${gId}`, { role: 'GESTOR', reason: 'Rebaixando um colega admin' })).status, 403);
  assert.equal((await call(g, 'GET', '/api/me')).body.user.isOwner, false);
});

test('perfil: CPF e e-mail não mudam; gestor e admin editam só o nome', { skip }, async () => {
  const c = await login('perfil@test.dev');
  await completeWorker(c, '418.529.637-19');
  const base = { name: 'Fulano de Tal', rg: '123456789', phone: '11999990000', address: 'Rua A, 1', city: 'São Paulo', uf: 'SP', emergencyName: 'Ciclano', emergencyPhone: '11988880000' };
  assert.equal((await call(c, 'PUT', '/api/me/profile', { ...base, cpf: '529.982.247-25' })).status, 400, 'CPF não muda');
  const ok = await call(c, 'PUT', '/api/me/profile', { ...base, cpf: '418.529.637-19', city: 'Guarulhos', email: 'outro@x.com' });
  assert.equal(ok.status, 200);
  const me = (await call(c, 'GET', '/api/me')).body;
  assert.equal(me.user.email, 'perfil@test.dev', 'e-mail ignorado');
  assert.equal(me.profile.city, 'Guarulhos');
  assert.equal((await call(c, 'PUT', '/api/me/name', { name: 'Outro Nome' })).status, 403, 'profissional usa o perfil completo');
  assert.equal((await call(s.gestor, 'PUT', '/api/me/name', { name: 'Gestor da Loja A', email: 'x@y.com' })).status, 200);
  const g = (await call(s.gestor, 'GET', '/api/me')).body.user;
  assert.deepEqual([g.name, g.email], ['Gestor da Loja A', 'gestor@test.dev']);
  assert.equal((await call(s.gestor, 'PUT', '/api/me/name', { name: 'x' })).status, 400);
});

test('visual único da UP Service: não existe mais troca de perfil de cores', { skip }, async () => {
  // Prepara o administrador principal e um administrador comum (usados nos testes seguintes).
  const a3 = await login('admin3@test.dev');
  await q("UPDATE users SET role = 'ADMINISTRADOR' WHERE email = 'admin3@test.dev'");
  await q("UPDATE users SET is_owner = 1 WHERE email = 'admin@test.dev'");
  assert.equal((await call(null, 'GET', '/api/config')).body.theme, undefined, 'o app não recebe tema');
  assert.equal((await call(s.admin, 'PUT', '/api/admin/settings/theme', { theme: 'atacadao' })).status, 404, 'rota removida');
  assert.equal((await call(a3, 'GET', '/api/me')).status, 200);
});

test('Configurações → WhatsApp: só o principal, chave nunca volta, instância, QR/código, teste e desconexão', { skip }, async () => {
  const http = await import('node:http');
  const calls = [];
  let state = 'missing';
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, key: req.headers.apikey, body: b ? JSON.parse(b) : null });
      const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const ok = req.headers.apikey === 'chave-geral' || (req.headers.apikey === 'chave-da-instancia' && req.url.includes('upservice'));
      if (!ok) return send(401, { error: 'Unauthorized' });
      if (req.url === '/instance/create') { state = 'close'; return send(201, { instance: { instanceName: 'upservice' }, hash: 'chave-da-instancia' }); }
      if (state === 'missing') return send(404, { error: 'not found' });
      if (req.url.startsWith('/instance/connectionState/')) return send(200, { instance: { state } });
      if (req.url.startsWith('/instance/connect/')) return send(200, req.url.includes('number=') ? { pairingCode: 'ABCD-1234' } : { base64: 'data:image/png;base64,iVBOR', code: 'x' });
      if (req.url.startsWith('/instance/logout/')) { state = 'close'; return send(200, { status: 'SUCCESS' }); }
      if (req.url.startsWith('/message/sendText/')) return send(201, { key: { id: '1' } });
      send(404, {});
    });
  }).listen(0);
  const URL_EVO = `http://localhost:${mock.address().port}`;
  try {
    await q("UPDATE users SET is_owner = 1 WHERE email = 'admin@test.dev'");
    const a3 = await login('admin-wa@test.dev');
    await q("UPDATE users SET role = 'ADMINISTRADOR' WHERE email = 'admin-wa@test.dev'");
    assert.equal((await call(a3, 'GET', '/api/admin/whatsapp')).status, 403, 'admin comum não vê');
    assert.equal((await call(s.gestor, 'PUT', '/api/admin/whatsapp', { url: URL_EVO, key: 'x' })).status, 403);
    assert.deepEqual((await call(s.admin, 'GET', '/api/admin/whatsapp')).body, { configured: false });

    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp', { url: 'ftp://x', key: 'k' })).status, 400);
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp', { url: URL_EVO, instance: 'up service', key: 'k' })).status, 400);
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp', { url: URL_EVO, key: '' })).status, 400, 'primeira vez exige a chave');
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp', { url: URL_EVO, instance: 'upservice', key: 'chave-geral' })).status, 200);
    const st = (await call(s.admin, 'GET', '/api/admin/whatsapp')).body;
    assert.equal(st.state, 'SEM_INSTANCIA');
    assert.equal(st.hasKey, true);
    assert.ok(!JSON.stringify(st).includes('chave-geral'), 'a chave nunca volta para a tela');

    assert.equal((await call(s.admin, 'POST', '/api/admin/whatsapp/create', {})).status, 200);
    assert.equal(calls.find((c) => c.url === '/instance/create').body.instanceName, 'upservice');
    assert.equal((await call(s.admin, 'GET', '/api/admin/whatsapp')).body.state, 'DESCONECTADO');
    assert.equal(calls.at(-1).key, 'chave-da-instancia', 'depois de criar, o app usa só a chave da instância');

    const qr = (await call(s.admin, 'POST', '/api/admin/whatsapp/connect', { method: 'qr' })).body;
    assert.equal(qr.qr, 'data:image/png;base64,iVBOR');
    const code = (await call(s.admin, 'POST', '/api/admin/whatsapp/connect', { method: 'code', phone: '(11) 92674-6277' })).body;
    assert.equal(code.pairingCode, 'ABCD-1234');
    assert.ok(calls.at(-1).url.endsWith('?number=5511926746277'));

    state = 'open';
    assert.equal((await call(s.admin, 'GET', '/api/admin/whatsapp')).body.state, 'CONECTADO');
    assert.equal((await call(s.admin, 'POST', '/api/admin/whatsapp/test', { phone: '11999990000' })).status, 200);
    assert.deepEqual(calls.at(-1).body, { number: '5511999990000', text: 'Teste do app UP Service: o WhatsApp está conectado. ✅' });
    assert.equal((await call(s.admin, 'POST', '/api/admin/whatsapp/logout', {})).status, 200);
    assert.equal((await call(s.admin, 'GET', '/api/admin/whatsapp')).body.state, 'DESCONECTADO');

    // Chave salva é mantida quando o campo vem vazio; variáveis do servidor têm prioridade e travam a edição.
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp', { url: URL_EVO, instance: 'upservice', key: '' })).status, 200);
    assert.equal((await call(s.admin, 'GET', '/api/admin/whatsapp')).body.hasKey, true);
    Object.assign(process.env, { EVOLUTION_API_URL: URL_EVO, EVOLUTION_API_KEY: 'chave-geral', EVOLUTION_INSTANCE: 'upservice' });
    assert.equal((await call(s.admin, 'GET', '/api/admin/whatsapp')).body.source, 'env');
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp', { url: URL_EVO, key: 'x' })).status, 409);
    const [log] = await q("SELECT COUNT(*) AS n FROM audit_events WHERE action LIKE 'WHATSAPP_%' OR action = 'SETTING_WHATSAPP'");
    assert.ok(Number(log.n) >= 6);
    const [row] = await q("SELECT after_json FROM audit_events WHERE action = 'SETTING_WHATSAPP' LIMIT 1").catch(() => [{}]);
    assert.ok(!JSON.stringify(row ?? {}).includes('chave-geral'), 'a auditoria não guarda a chave');
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    mock.close();
    await q("DELETE FROM app_settings WHERE name = 'evolution'");
  }
});

test('números públicos do site: só totais, iguais ao banco', { skip }, async () => {
  const r = await call(null, 'GET', '/api/public/stats');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['atualizadoEm', 'desde', 'diarias', 'lojas', 'profissionais', 'vagasAbertas']);
  const [db] = await q(`SELECT (SELECT COUNT(*) FROM units WHERE status = 'ATIVA') AS lojas,
    (SELECT COUNT(*) FROM users WHERE role = 'PROFISSIONAL' AND deleted_at IS NULL AND status <> 'INATIVO') AS profissionais,
    (SELECT COUNT(*) FROM daily_confirmations WHERE result = 'CONCLUIDA') AS diarias`);
  assert.deepEqual([r.body.lojas, r.body.profissionais, r.body.diarias], [Number(db.lojas), Number(db.profissionais), Number(db.diarias)]);
  assert.ok(r.body.lojas > 0 && r.body.diarias > 0, 'os testes anteriores criaram lojas e diárias');
  assert.match(r.res.headers.get('cache-control'), /max-age=600/);
});

test('login por senha, recuperação, QR Code e código por WhatsApp', { skip }, async () => {
  const { createHash } = await import('node:crypto');
  const http = await import('node:http');
  const sha = (v) => createHash('sha256').update(v).digest('hex');
  const cookieOf = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0];
  const waitFor = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); };
  await q('DELETE FROM rate_limits');

  // Senha: conta só do Google ainda não tem senha; erro igual para e-mail inexistente.
  const u = await login('senha@test.dev');
  const uid = (await userByEmail('senha@test.dev')).id;
  const wrong = await call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'qualquer123' });
  const ghost = await call(null, 'POST', '/api/auth/password', { email: 'ninguem@test.dev', password: 'qualquer123' });
  assert.deepEqual([wrong.status, ghost.status, wrong.body.error], [401, 401, ghost.body.error]);

  // Esqueci: resposta igual exista ou não a conta; token guardado só como hash, e o anterior é invalidado.
  const f1 = await call(null, 'POST', '/api/auth/password/forgot', { email: 'SENHA@test.dev ' });
  const f2 = await call(null, 'POST', '/api/auth/password/forgot', { email: 'ninguem@test.dev' });
  assert.deepEqual([f1.status, f1.body], [f2.status, f2.body]);
  await call(null, 'POST', '/api/auth/password/forgot', { email: 'senha@test.dev' });
  await new Promise((r) => setTimeout(r, 200)); // o pedido roda depois da resposta
  const tokens = await q("SELECT id, used_at FROM auth_tokens WHERE kind = 'RESET' AND user_id = ? ORDER BY created_at", [uid]);
  assert.equal(tokens.length, 2);
  assert.ok(tokens[0].used_at, 'pedido novo invalida o link anterior');
  // O e-mail não sai nos testes: troca o hash do token válido por um conhecido.
  await q('UPDATE auth_tokens SET token_hash = ? WHERE id = ?', [sha('token-teste'), tokens[1].id]);
  assert.equal((await call(null, 'POST', '/api/auth/password/reset', { token: 'token-teste', password: 'curta1' })).status, 400, 'senha fraca');
  assert.equal((await call(null, 'POST', '/api/auth/password/reset', { token: 'outro', password: 'SenhaBoa123' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/password/reset', { token: 'token-teste', password: 'SenhaBoa123' })).status, 200);
  assert.equal((await call(null, 'POST', '/api/auth/password/reset', { token: 'token-teste', password: 'OutraSenha123' })).status, 400, 'uso único');
  assert.equal((await call(u, 'GET', '/api/me')).status, 401, 'trocar a senha encerra as sessões abertas');
  const [stored] = await q('SELECT password_hash FROM users WHERE id = ?', [uid]);
  assert.match(stored.password_hash, /^scrypt\$/);
  assert.ok(!stored.password_hash.includes('SenhaBoa123'));
  const [exp] = await q("SELECT id FROM auth_tokens WHERE kind = 'RESET' AND user_id = ? ORDER BY created_at DESC LIMIT 1", [uid]);
  await q('UPDATE auth_tokens SET token_hash = ?, used_at = NULL, expires_at = ? WHERE id = ?', [sha('vencido'), new Date(Date.now() - 1000), exp.id]);
  assert.equal((await call(null, 'POST', '/api/auth/password/reset', { token: 'vencido', password: 'SenhaBoa123' })).status, 400, 'link vencido');

  const ok = await call(null, 'POST', '/api/auth/password', { email: 'Senha@Test.dev', password: 'SenhaBoa123' });
  assert.equal(ok.status, 200);
  const pw = cookieOf(ok.res, 'sid');
  assert.equal((await call(pw, 'GET', '/api/me')).body.user.email, 'senha@test.dev');
  await q("UPDATE users SET status = 'INATIVO' WHERE id = ?", [uid]);
  assert.equal((await call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'SenhaBoa123' })).status, 403, 'conta inativa não entra');
  await q("UPDATE users SET status = 'ATIVO' WHERE id = ?", [uid]);
  // Acertar não gasta tentativa: logins certos seguidos continuam passando.
  for (let i = 0; i < 12; i++) assert.equal((await call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'SenhaBoa123' })).status, 200);
  await q('DELETE FROM rate_limits');
  let last;
  // Pedidos simultâneos não furam o limite: de 15 erros ao mesmo tempo, só 10 passam pela conferência.
  const burst = await Promise.all(Array.from({ length: 15 }, () => call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'errada123' })));
  const conferidas = burst.filter((b) => b.status === 401).length;
  assert.ok(conferidas <= 10, `no máximo 10 conferências, vieram ${conferidas}`);
  assert.equal(conferidas + burst.filter((b) => b.status === 429).length, 15);
  // Recusas devolvem a reserva: completando até 10 erros, um por vez, o próximo é recusado.
  for (let i = conferidas; i < 10; i++) assert.equal((await call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'errada123' })).status, 401);
  last = await call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'errada123' });
  assert.equal(last.status, 429, 'limite de erros por e-mail');
  await q('DELETE FROM rate_limits');

  // QR Code: o QR só tem o id; sem sessão no celular não aprova; número errado 3x invalida; a sessão sai uma vez só.
  const start = await call(null, 'POST', '/api/auth/qr/start');
  const { id, code } = start.body;
  const secret = cookieOf(start.res, 'qr_secret');
  assert.ok(secret && /^\d{2}$/.test(code));
  assert.equal((await call(null, 'POST', `/api/auth/qr/${id}/approve`, { code })).status, 401);
  assert.equal((await call(pw, 'GET', `/api/auth/qr/${id}`)).body.code, undefined, 'o celular não recebe o número');
  assert.deepEqual((await call(secret, 'GET', `/api/auth/qr/${id}/status`)).body, { status: 'AGUARDANDO' });
  assert.equal((await call('qr_secret=falso', 'GET', `/api/auth/qr/${id}/status`)).status, 404, 'sem o segredo do computador');
  const bad = code === '99' ? '98' : '99';
  assert.equal((await call(pw, 'POST', `/api/auth/qr/${id}/approve`, { code: bad })).status, 400);
  assert.equal((await call(pw, 'POST', `/api/auth/qr/${id}/approve`, { code })).status, 200);
  const st = await call(secret, 'GET', `/api/auth/qr/${id}/status`);
  assert.equal(st.body.status, 'CONFIRMADO');
  const desk = cookieOf(st.res, 'sid');
  assert.equal(cookieOf(st.res, 'qr_secret'), 'qr_secret=', 'segredo apagado');
  assert.equal((await call(desk, 'GET', '/api/me')).body.user.email, 'senha@test.dev');
  assert.deepEqual((await call(secret, 'GET', `/api/auth/qr/${id}/status`)).body, { status: 'ENCERRADO' }, 'uso único');

  const s2 = await call(null, 'POST', '/api/auth/qr/start');
  const bad2 = s2.body.code === '99' ? '98' : '99';
  for (let i = 0; i < 3; i++) await call(pw, 'POST', `/api/auth/qr/${s2.body.id}/approve`, { code: bad2 });
  assert.equal((await call(pw, 'POST', `/api/auth/qr/${s2.body.id}/approve`, { code: s2.body.code })).status, 409, '3 erros invalidam');
  const s3 = await call(null, 'POST', '/api/auth/qr/start');
  await q('UPDATE auth_tokens SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 1000), s3.body.id]);
  assert.equal((await call(pw, 'POST', `/api/auth/qr/${s3.body.id}/approve`, { code: s3.body.code })).status, 409, 'expirado');
  assert.deepEqual((await call(cookieOf(s3.res, 'qr_secret'), 'GET', `/api/auth/qr/${s3.body.id}/status`)).body, { status: 'EXPIRADO' });

  // QR de outra rede (golpe com QR verdadeiro num site falso): o celular vê o IP e precisa confirmar de forma explícita.
  const s4 = await call(null, 'POST', '/api/auth/qr/start');
  await q("UPDATE auth_tokens SET created_ip = '203.0.113.9' WHERE id = ?", [s4.body.id]);
  const info4 = (await call(pw, 'GET', `/api/auth/qr/${s4.body.id}`)).body;
  assert.deepEqual([info4.ip, info4.sameNetwork], ['203.0.113.9', false]);
  assert.equal((await call(pw, 'POST', `/api/auth/qr/${s4.body.id}/approve`, { code: s4.body.code })).status, 428, 'outra rede exige confirmação');
  assert.equal((await call(pw, 'POST', `/api/auth/qr/${s4.body.id}/approve`, { code: s4.body.code, otherNetwork: true })).status, 200);

  // Senha: teto diário de erros por conta (qualquer IP); criar uma senha nova zera e o dono volta a entrar.
  await q('DELETE FROM rate_limits');
  await q('INSERT INTO rate_limits (k, window_start, n) VALUES (?, ?, 30)', [sha('pw:erro:dia:senha@test.dev'), new Date()]);
  assert.equal((await call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'SenhaBoa123' })).status, 429, '30 erros no dia: senha travada');
  await call(null, 'POST', '/api/auth/password/forgot', { email: 'senha@test.dev' });
  await new Promise((r) => setTimeout(r, 200)); // o pedido roda depois da resposta
  const [rt] = await q("SELECT id FROM auth_tokens WHERE kind = 'RESET' AND user_id = ? ORDER BY created_at DESC LIMIT 1", [uid]);
  await q('UPDATE auth_tokens SET token_hash = ? WHERE id = ?', [sha('token-dois'), rt.id]);
  assert.equal((await call(null, 'POST', '/api/auth/password/reset', { token: 'token-dois', password: 'SenhaNova456' })).status, 200);
  assert.equal((await call(null, 'POST', '/api/auth/password', { email: 'senha@test.dev', password: 'SenhaNova456' })).status, 200, 'senha nova destrava');
  await q('DELETE FROM rate_limits');

  // WhatsApp: escondido sem configuração; só número confirmado entra; um número por conta; código 1x; 5 erros invalidam.
  assert.equal((await call(null, 'GET', '/api/config')).body.phoneLogin, false);
  assert.equal((await call(null, 'POST', '/api/auth/phone/start', { phone: '11999990000' })).status, 503);
  const sent = [];
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      // Estado da conexão: conectado (não conta como mensagem enviada).
      if (req.url.startsWith('/instance/connectionState')) return res.end(JSON.stringify({ instance: { state: 'open' } }));
      sent.push({ url: req.url, key: req.headers.apikey, body: JSON.parse(b) }); res.end('{}');
    });
  }).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}/`, EVOLUTION_API_KEY: 'chave-teste', EVOLUTION_INSTANCE: 'upservice' });
  const waA = await login('wa-a@test.dev');
  const waB = await login('wa-b@test.dev');
  const w2 = (await userByEmail('wa-a@test.dev')).id;
  const waitSent = async (n) => { for (let i = 0; i < 40 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };
  const lastCode = () => /(\d{6})/.exec(sent.at(-1).body.text)[1];
  try {
    assert.equal((await call(null, 'GET', '/api/config')).body.phoneLogin, true);

    // O telefone do cadastro (não confirmado) não dá acesso: nada é enviado.
    const none = await call(null, 'POST', '/api/auth/phone/start', { phone: '(11) 99999-0000' });
    assert.equal(none.body.ok, true);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sent.length, 0, 'número só do cadastro não recebe código de login');

    // Confirmar o número na conta (logado).
    assert.equal((await call(null, 'POST', '/api/me/whatsapp/start', { phone: '11977776666' })).status, 401);
    assert.equal((await call(waA, 'POST', '/api/me/whatsapp/start', { phone: '+55 11 97777-6666' })).status, 200);
    await waitSent(1);
    assert.deepEqual([sent.at(-1).url, sent.at(-1).key, sent.at(-1).body.number], ['/message/sendText/upservice', 'chave-teste', '5511977776666']);
    assert.equal((await call(waA, 'POST', '/api/me/whatsapp/verify', { code: lastCode() === '000000' ? '111111' : '000000' })).status, 400);
    assert.equal((await call(waA, 'POST', '/api/me/whatsapp/verify', { code: lastCode() })).status, 200);
    assert.equal((await call(waA, 'GET', '/api/me')).body.user.whatsapp, '11977776666');
    const [vrow] = await q("SELECT * FROM auth_tokens WHERE kind = 'VERIFY' AND user_id = ?", [w2]);
    assert.ok(!JSON.stringify(vrow).includes(lastCode()), 'código guardado só como hash');
    // Número já confirmado em outra conta: resposta igual e nada é enviado (não revela quem tem conta).
    const before = sent.length;
    const taken = await call(waB, 'POST', '/api/me/whatsapp/start', { phone: '11977776666' });
    assert.equal(taken.status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(sent.length, before, 'número de outra conta não recebe código');

    // Login por código, preso ao aparelho que pediu (cookie otp_device).
    const ask = async (n) => { const st = await call(null, 'POST', '/api/auth/phone/start', { phone: '11977776666' }); await waitSent(n); return [cookieOf(st.res, 'otp_device'), lastCode()]; };
    const [dev1, otp1] = await ask(2);
    assert.ok(dev1);
    // Outro aparelho (sem o cookie) não confere, não chuta e não invalida o código de quem pediu.
    for (let i = 0; i < 6; i++) assert.equal((await call(null, 'POST', '/api/auth/phone/verify', { phone: '11977776666', code: otp1 === '000000' ? '111111' : '000000' })).status, 401);
    // Pedir de novo em outro aparelho também não derruba o código pendente.
    const [dev2] = await ask(3);
    assert.notEqual(dev2, dev1);
    assert.equal((await call(dev1, 'POST', '/api/auth/phone/verify', { phone: '11977776666', code: otp1 === '000000' ? '111111' : '000000' })).status, 401);
    const v = await call(dev1, 'POST', '/api/auth/phone/verify', { phone: '11977776666', code: otp1 });
    assert.equal(v.status, 200, 'o dono entra mesmo com chutes de outros aparelhos');
    assert.equal((await call(cookieOf(v.res, 'sid'), 'GET', '/api/me')).body.user.email, 'wa-a@test.dev');
    assert.equal((await call(dev1, 'POST', '/api/auth/phone/verify', { phone: '11977776666', code: otp1 })).status, 401, 'uso único');

    const [dev3, otp3] = await ask(4);
    for (let i = 0; i < 5; i++) await call(dev3, 'POST', '/api/auth/phone/verify', { phone: '11977776666', code: otp3 === '000000' ? '111111' : '000000' });
    assert.equal((await call(dev3, 'POST', '/api/auth/phone/verify', { phone: '11977776666', code: otp3 })).status, 401, '5 erros no próprio aparelho invalidam');
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    mock.close();
    await q('DELETE FROM rate_limits');
  }
});

test('reserva chamada recebe WhatsApp (se tiver número confirmado), só depois de gravar', { skip }, async () => {
  const http = await import('node:http');
  // CPF válido a partir de 9 dígitos (dígitos verificadores calculados).
  const cpf = (base) => {
    const d = base.split('').map(Number);
    for (const n of [9, 10]) { const s = d.reduce((t, v, i) => t + v * (n + 1 - i), 0); d.push(((s * 10) % 11) % 10); }
    return d.join('');
  };
  const sent = [];
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { sent.push({ url: req.url, body: JSON.parse(b || '{}') }); res.end('{}'); });
  }).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}`, EVOLUTION_API_KEY: 'chave', EVOLUTION_INSTANCE: 'upservice' });
  try {
    const [ana, beto] = [await login('ana-res@test.dev'), await login('beto-res@test.dev')];
    await completeWorker(ana, cpf('184720593'));
    await completeWorker(beto, cpf('293861047'));
    await q("UPDATE users SET whatsapp = '11966665555', whatsapp_verified_at = ? WHERE email = 'beto-res@test.dev'", [new Date()]);
    const starts = new Date(Date.now() + 3 * 86400e3);
    const job = (await call(s.gestor, 'POST', '/api/manage/jobs', {
      unitId: s.unitA, title: 'Repositor reserva WhatsApp', startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600e3), positions: 1, dailyValue: 130, breakCount: 1, breakMinutes: 15, publish: true,
    })).body.id;
    const a = (await call(ana, 'POST', `/api/jobs/${job}/apply`, {})).body;
    const b = (await call(beto, 'POST', `/api/jobs/${job}/apply`, {})).body;
    assert.deepEqual([a.status, b.status], ['APROVADA', 'RESERVA']);
    assert.equal(sent.length, 0, 'entrar na reserva não manda nada');

    // Ana desiste: Beto é aprovado e recebe o WhatsApp no número confirmado.
    assert.equal((await call(ana, 'POST', `/api/me/applications/${a.id}/cancel`, {})).status, 200);
    assert.equal((await q('SELECT status FROM applications WHERE id = ?', [b.id]))[0].status, 'APROVADA');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/message/sendText/upservice');
    assert.equal(sent[0].body.number, '5511966665555');
    assert.match(sent[0].body.text, /saiu da reserva/);
    assert.match(sent[0].body.text, /Repositor reserva WhatsApp/);
    // Também dentro do app: aviso não lido e a diária contada no botão "Diárias".
    const av = (await call(beto, 'GET', '/api/me/avisos')).body;
    assert.equal(av.unread, 1);
    assert.equal(av.items[0].title, 'Você saiu da reserva!');
    assert.match(av.items[0].body, /Repositor reserva WhatsApp/);
    assert.equal(av.upcoming, 1);
    assert.equal((await call(ana, 'GET', '/api/me/avisos')).body.unread, 0, 'quem desistiu não recebe aviso');
    assert.equal((await call(beto, 'POST', '/api/me/avisos/lidos', {})).status, 200);
    assert.equal((await call(beto, 'GET', '/api/me/avisos')).body.unread, 0);

    // Sem WhatsApp confirmado: a chamada acontece igual, só sem mensagem.
    const cris = await login('cris-res@test.dev');
    await completeWorker(cris, cpf('381946205'));
    const job2 = (await call(s.gestor, 'POST', '/api/manage/jobs', {
      unitId: s.unitA, title: 'Repositor sem WhatsApp', startsAt: new Date(starts.getTime() + 86400e3), endsAt: new Date(starts.getTime() + 86400e3 + 8 * 3600e3), positions: 1, dailyValue: 130, breakCount: 1, breakMinutes: 15, publish: true,
    })).body.id;
    const a2 = (await call(beto, 'POST', `/api/jobs/${job2}/apply`, {})).body;
    const c2 = (await call(cris, 'POST', `/api/jobs/${job2}/apply`, {})).body;
    assert.equal((await call(beto, 'POST', `/api/me/applications/${a2.id}/cancel`, {})).status, 200);
    assert.equal((await q('SELECT status FROM applications WHERE id = ?', [c2.id]))[0].status, 'APROVADA');
    assert.equal(sent.length, 1, 'sem número confirmado, nada é enviado');
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    mock.close();
  }
});

test('estrelas: profissional só vê com o interruptor ligado; principal liga; gestor confere a ficha; bônus do mês pela gestão', { skip }, async () => {
  assert.equal((await call(null, 'GET', '/api/config')).body.gamification, false);
  assert.equal((await call(s.w1, 'GET', '/api/me/estrelas')).status, 403, 'desligado: profissional não vê');
  assert.equal((await call(s.gestor, 'PUT', '/api/admin/settings/gamification', { enabled: true })).status, 403);
  await q("UPDATE users SET is_owner = 1 WHERE email = 'admin@test.dev'");
  const w1 = (await userByEmail('w1@test.dev')).id;
  const preview = await call(s.admin, 'GET', `/api/manage/workers/${w1}/estrelas`);
  assert.equal(preview.status, 200, 'admin confere mesmo desligado');
  assert.ok(Array.isArray(preview.body.months) && preview.body.months.length >= 1);
  assert.equal((await call(s.admin, 'PUT', '/api/admin/settings/gamification', { enabled: true })).status, 200);
  assert.equal((await call(null, 'GET', '/api/config')).body.gamification, true);
  const mine = await call(s.w1, 'GET', '/api/me/estrelas');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.total, preview.body.total);
  assert.equal(mine.body.months.length, 12, 'um nível por mês do ano');
  // Personagem do jogo: começa vazio (a tela pede a escolha), só aceita os da lista e fica salvo.
  assert.equal(mine.body.personagem, null);
  assert.equal((await call(s.w1, 'PUT', '/api/me/personagem', { id: 'pirata' })).status, 400);
  assert.equal((await call(s.gestor, 'PUT', '/api/me/personagem', { id: 'mago' })).status, 403);
  assert.equal((await call(s.w1, 'PUT', '/api/me/personagem', { id: 'arqueira' })).status, 200);
  assert.equal((await call(s.w1, 'GET', '/api/me/estrelas')).body.personagem, 'arqueira');
  assert.ok(mine.body.months.some((m) => m.month === mine.body.current), 'mês atual sempre aparece');
  for (const m of mine.body.months) for (const d of m.diaries) assert.ok(d.stars === null || (d.stars >= 0 && d.stars <= 3));
  // Bônus do mês: só gestão define; o sistema sorteia os dias e a soma é o valor; o valor do dia futuro não vai para o profissional.
  const year = mine.body.year;
  const next = `${year}-12`;
  assert.equal((await call(s.w1, 'GET', `/api/manage/bonus?month=${next}`)).status, 403);
  assert.equal((await call(s.w1, 'PUT', `/api/manage/bonus/${next}`, { total: 100 })).status, 403);
  assert.equal((await call(s.gestor, 'GET', `/api/manage/bonus?month=${next}`)).status, 403, 'gestor não vê o bônus do mês');
  assert.equal((await call(s.gestor, 'PUT', `/api/manage/bonus/${next}`, { total: 100 })).status, 403, 'gestor não define o bônus do mês');
  assert.equal((await call(s.admin, 'PUT', `/api/manage/bonus/${next}`, { total: -1 })).status, 400);
  const set = await call(s.admin, 'PUT', `/api/manage/bonus/${next}`, { total: 100 });
  assert.equal(set.status, 200);
  assert.equal(set.body.days.reduce((t, b) => t + b.value, 0), 100);
  const view = await call(s.admin, 'GET', `/api/manage/bonus?month=${next}`);
  assert.equal(view.body.total, 100);
  assert.ok(view.body.days.some((b) => b.kind === 'SORTEIO'), 'sorteio da TV em 20/12');
  const dez = (await call(s.w1, 'GET', '/api/me/estrelas')).body.months[11];
  const bonusDays = dez.days.filter((d) => d.bonus?.kind === 'BONUS');
  assert.equal(bonusDays.length, set.body.days.length);
  assert.ok(bonusDays.every((d) => d.bonus.value === null), 'valor escondido até o dia');
  // Depois que um dia de bônus do mês chegou, o valor não muda mais.
  const cur = mine.body.current;
  await q("INSERT INTO bonus_days (day, kind, value) VALUES (?, 'BONUS', 10)", [`${cur}-01`]);
  assert.equal((await call(s.admin, 'PUT', `/api/manage/bonus/${cur}`, { total: 50 })).status, 409);
  await q('DELETE FROM bonus_days WHERE day = ?', [`${cur}-01`]);
  assert.equal((await call(s.admin, 'PUT', '/api/admin/settings/gamification', { enabled: false })).status, 200);
  assert.equal((await call(s.w1, 'GET', '/api/me/estrelas')).status, 403);
});

test('carteira: chave Pix obrigatória para pagar, código Pix, pagamento com comprovante (no app e pelo WhatsApp)', { skip }, async () => {
  const http = await import('node:http');
  const sent = [];
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { sent.push({ url: req.url, body: JSON.parse(b || '{}') }); res.end('{}'); });
  }).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}`, EVOLUTION_API_KEY: 'chave', EVOLUTION_INSTANCE: 'upservice' });
  try {
    const me = (await call(s.winner, 'GET', '/api/me')).body.user;
    const before = (await call(s.winner, 'GET', '/api/me/carteira')).body;
    assert.equal(before.aReceber, (await call(s.winner, 'GET', '/api/me/summary')).body.valor, 'mesmo saldo no resumo e na carteira');
    assert.ok(before.aReceber >= 150.5);
    assert.ok(before.itens.some((i) => i.kind === 'DIARIA'));
    assert.equal(before.pixKey, null);
    assert.equal((await call(s.gestor, 'GET', `/api/manage/workers/${me.id}/pagamento`)).body.payload, null, 'sem chave, sem código Pix');
    assert.equal((await call(s.gestor, 'POST', `/api/manage/workers/${me.id}/pagamentos`, { amount: 10, receipt: JPEG })).status, 409, 'sem chave não paga');

    assert.equal((await call(s.winner, 'PUT', '/api/me/pix', { type: 'CPF', key: '111.111.111-11' })).status, 400);
    assert.equal((await call(s.winner, 'PUT', '/api/me/pix', { type: 'XYZ', key: 'a' })).status, 400);
    const pix = await call(s.winner, 'PUT', '/api/me/pix', { type: 'TELEFONE', key: '(11) 95555-4444' });
    assert.equal(pix.status, 200);
    assert.equal(pix.body.pixKey, '+5511955554444');
    assert.equal((await call(s.gestor, 'PUT', '/api/me/pix', { type: 'TELEFONE', key: '11955554444' })).status, 403, 'só profissional');

    const pay = (await call(s.gestor, 'GET', `/api/manage/workers/${me.id}/pagamento`)).body;
    assert.match(pay.payload, /^000201.*br\.gov\.bcb\.pix.*\+5511955554444.*6304[0-9A-F]{4}$/);
    assert.ok(pay.payload.includes(`54${String(before.aReceber.toFixed(2).length).padStart(2, '0')}${before.aReceber.toFixed(2)}`), 'valor em aberto no código');
    assert.equal((await call(s.loser, 'GET', `/api/manage/workers/${me.id}/pagamento`)).status, 403, 'profissional não vê pagamento de ninguém');

    const url = `/api/manage/workers/${me.id}/pagamentos`;
    assert.equal((await call(s.gestor, 'POST', url, { amount: 100 })).status, 400, 'sem comprovante');
    assert.equal((await call(s.gestor, 'POST', url, { amount: 100, receipt: Buffer.from('oi').toString('base64') })).status, 400, 'formato');
    assert.equal((await call(s.gestor, 'POST', url, { amount: before.aReceber + 1, receipt: JPEG })).status, 400, 'acima do saldo');
    assert.equal((await call(s.winner, 'POST', url, { amount: 10, receipt: JPEG })).status, 403);
    await q('UPDATE users SET whatsapp = ? WHERE id = ?', ['11944443333', me.id]);
    const paid = await call(s.gestor, 'POST', url, { amount: 100, receipt: JPEG, note: 'Semana 1' });
    assert.equal(paid.status, 200);
    assert.equal(Math.round(paid.body.aReceber * 100), Math.round((before.aReceber - 100) * 100), 'saldo cai');

    const after = (await call(s.winner, 'GET', '/api/me/carteira')).body;
    assert.equal(after.pago, before.pago + 100);
    assert.equal(after.pagamentos[0].amount, 100);
    assert.equal(after.pagamentos[0].receipt, true);
    const rid = after.pagamentos[0].id;
    assert.equal((await call(s.winner, 'GET', `/api/files/comprovante/${rid}`)).status, 200);
    assert.equal((await call(s.gestor, 'GET', `/api/files/comprovante/${rid}`)).status, 200);
    assert.ok([403, 404].includes((await call(s.loser, 'GET', `/api/files/comprovante/${rid}`)).status), 'outro profissional não vê');
    const av = (await call(s.winner, 'GET', '/api/me/avisos')).body;
    assert.match(av.items[0].title, /Pagamento recebido/);

    // O mesmo comprovante vai pelo WhatsApp (em segundo plano).
    for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/message/sendMedia/upservice');
    assert.equal(sent[0].body.number, '5511944443333');
    assert.equal(sent[0].body.mediatype, 'image');
    assert.equal(sent[0].body.media, Buffer.from(JPEG, 'base64').toString('base64'));
    assert.match(sent[0].body.caption, /R\$\s?100,00/);

    // Troca de chave (conta invadida?): aviso no app e no WhatsApp confirmado; o gestor vê que a chave mudou.
    assert.equal((await call(s.gestor, 'GET', `/api/manage/workers/${me.id}/pagamento`)).body.pixChangedAt, null, 'primeiro cadastro não é troca');
    await q('UPDATE users SET whatsapp_verified_at = ? WHERE id = ?', [new Date(), me.id]);
    assert.equal((await call(s.winner, 'PUT', '/api/me/pix', { type: 'EMAIL', key: 'novo@exemplo.com' })).status, 200);
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent[1].url, '/message/sendText/upservice');
    assert.match(sent[1].body.text, /chave Pix da sua conta foi trocada/);
    assert.match((await call(s.winner, 'GET', '/api/me/avisos')).body.items[0].title, /chave Pix foi trocada/);
    assert.ok((await call(s.gestor, 'GET', `/api/manage/workers/${me.id}/pagamento`)).body.pixChangedAt, 'gestor vê a troca');
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    mock.close();
  }
});

test('quebra de caixa: só em diária de caixa encerrada, abate da Carteira com motivo, uma revisão, sem virar ocorrência', { skip }, async () => {
  const me = (await call(s.winner, 'GET', '/api/me')).body.user;
  const caixa = await approvedSession(s.winner, 'Operador de Caixa teste');
  const [job] = await q('SELECT is_cashier FROM jobs WHERE id = ?', [caixa.job]);
  assert.equal(job.is_cashier, 1, '"caixa" no título marca a vaga');
  assert.equal((await call(s.winner, 'GET', '/api/jobs')).body.find((j) => j.id === caixa.job)?.is_cashier, 1, 'profissional vê que é de caixa');
  const url = `/api/manage/applications/${caixa.application}/quebra-caixa`;
  assert.equal((await call(s.gestor, 'POST', url, { amount: 30, reason: 'Faltou dinheiro no fechamento' })).status, 409, 'antes do fim da diária');

  const [g] = await q("SELECT id FROM users WHERE email = 'gestor@test.dev'");
  const finish = async (a) => {
    await q("UPDATE work_sessions SET status = 'FINALIZADA' WHERE id = ?", [a.session]);
    await q("INSERT INTO daily_confirmations (application_id, result, confirmed_by) VALUES (?, 'CONCLUIDA', ?)", [a.application, g.id]);
  };
  await finish(caixa);
  const outra = await approvedSession(s.winner, 'Repositor de frios');
  await finish(outra);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${outra.application}/quebra-caixa`, { amount: 30, reason: 'Faltou dinheiro no fechamento' })).status, 409, 'vaga que não é de caixa');
  assert.equal((await call(s.gestor, 'POST', url, { amount: 101, reason: 'Faltou dinheiro no fechamento' })).status, 400, 'acima do valor da diária');
  assert.equal((await call(s.gestor, 'POST', url, { amount: 30, reason: 'x' })).status, 400, 'motivo obrigatório');
  assert.equal((await call(s.winner, 'POST', url, { amount: 30, reason: 'Faltou dinheiro no fechamento' })).status, 403);

  const before = (await call(s.winner, 'GET', '/api/me/carteira')).body;
  const set = await call(s.gestor, 'POST', url, { amount: 30, reason: 'Faltou R$ 30 no fechamento do caixa 4' });
  assert.equal(set.status, 201);
  assert.equal((await call(s.gestor, 'POST', url, { amount: 10, reason: 'Faltou dinheiro de novo' })).status, 409, 'uma por diária');
  const after = (await call(s.winner, 'GET', '/api/me/carteira')).body;
  assert.equal(Math.round((before.aReceber - after.aReceber) * 100), 3000, 'abate R$ 30');
  assert.equal(after.quebras, before.quebras + 30);
  const ab = after.abatimentos.find((x) => x.id === set.body.id);
  assert.equal(ab.reason, 'Faltou R$ 30 no fechamento do caixa 4');
  assert.equal(ab.counts, true);
  assert.equal((await q('SELECT COUNT(*) AS n FROM occurrences WHERE application_id = ?', [caixa.application]))[0].n, 0, 'não é ocorrência');
  assert.match((await call(s.winner, 'GET', '/api/me/avisos')).body.items[0].title, /Quebra de caixa registrada/);
  const session = (await call(s.gestor, 'GET', `/api/manage/sessions?unitId=${s.unitA}&date=${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}`)).body.sessions.find((x) => x.application_id === caixa.application);
  if (session) assert.equal(Number(session.cash_break_amount), 30, 'Atividades mostram a quebra');

  // Uma revisão só; não aparece entre as ocorrências; o gestor ajusta e depois cancela.
  const review = await call(s.winner, 'POST', '/api/me/contestations', { cashBreakId: set.body.id, message: 'O caixa foi conferido por outra pessoa no fim.' });
  assert.equal(review.status, 201);
  assert.equal((await call(s.winner, 'POST', '/api/me/contestations', { cashBreakId: set.body.id, message: 'Pedindo de novo a revisão.' })).status, 409);
  assert.ok(!(await call(s.winner, 'GET', '/api/me/occurrences')).body.contestations.some((c) => c.protocol === review.body.protocol), 'fora das ocorrências');
  const inbox = (await call(s.gestor, 'GET', '/api/manage/inbox')).body.items.find((i) => i.title.includes(review.body.protocol));
  assert.equal(inbox.kind, 'REVISAO_QUEBRA');
  const [ct] = await q('SELECT id FROM contestations WHERE protocol = ?', [review.body.protocol]);
  const decide = (body) => call(s.gestor, 'POST', `/api/manage/contestations/${ct.id}/decide`, { reason: 'Conferido com a filmagem do caixa.', ...body });
  assert.equal((await decide({ decision: 'AJUSTADA', newAmount: 40 })).status, 400, 'ajuste só para menos');
  assert.equal((await decide({ decision: 'AJUSTADA', newAmount: 10 })).status, 200);
  const adj = (await call(s.winner, 'GET', '/api/me/carteira')).body;
  assert.equal(Math.round((before.aReceber - adj.aReceber) * 100), 1000, 'abate o valor revisado');
  assert.equal(adj.abatimentos.find((x) => x.id === set.body.id).review.status, 'AJUSTADA');
  assert.equal((await call(s.winner, 'POST', '/api/me/contestations', { cashBreakId: set.body.id, message: 'Quero outra revisão.' })).status, 409, 'decisão final');
  assert.equal((await call(s.gestor, 'POST', `/api/manage/quebras/${set.body.id}/cancel`, { reason: 'Lançada na diária errada.' })).status, 200);
  assert.equal((await call(s.gestor, 'POST', `/api/manage/quebras/${set.body.id}/cancel`, { reason: 'Lançada na diária errada.' })).status, 409);
  assert.equal((await call(s.winner, 'GET', '/api/me/carteira')).body.aReceber, before.aReceber, 'cancelada não abate');
  assert.equal((await call(s.gestor, 'GET', `/api/manage/workers/${me.id}/quebras`)).body.length >= 1, true);
});

test('pagamentos (admin): lista quem tem a receber, com a mesma conta da Carteira; só administrador vê', { skip }, async () => {
  assert.equal((await call(s.gestor, 'GET', '/api/admin/pagamentos')).status, 403);
  assert.equal((await call(s.w1, 'GET', '/api/admin/pagamentos')).status, 403);
  const r = await call(s.admin, 'GET', '/api/admin/pagamentos');
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length >= 1, 'há alguém com valor a receber');
  assert.equal(r.body.count, r.body.items.length);
  assert.ok(r.body.items.every((x) => x.aReceber > 0), 'só quem tem a receber');
  for (let i = 1; i < r.body.items.length; i++) assert.ok(r.body.items[i - 1].aReceber >= r.body.items[i].aReceber, 'maior valor primeiro');
  for (const x of r.body.items) {
    const w = (await call(s.admin, 'GET', `/api/manage/workers/${x.id}/pagamento`)).body;
    assert.equal(Math.round(x.aReceber * 100), Math.round(w.aReceber * 100), `${x.name}: mesma conta da Carteira`);
    assert.equal(x.pixKey ?? null, w.pixKey ?? null);
  }
  const resumo = (await call(s.admin, 'GET', '/api/admin/pagamentos?resumo=1')).body;
  assert.equal(resumo.count, r.body.count);
  assert.equal(Math.round(resumo.total * 100), Math.round(r.body.items.reduce((t, x) => t + x.aReceber, 0) * 100));
  // Quem recebe o valor todo sai da lista.
  const alvo = r.body.items.find((x) => x.pixKey);
  if (alvo) {
    assert.equal((await call(s.admin, 'POST', `/api/manage/workers/${alvo.id}/pagamentos`, { amount: alvo.aReceber, receipt: JPEG })).status, 200);
    assert.ok(!(await call(s.admin, 'GET', '/api/admin/pagamentos')).body.items.some((x) => x.id === alvo.id), 'quitado sai da lista');
  }
});

test('brinde do dia: só admin cadastra; sorteio às 9h do dia seguinte entre quem fez 3 estrelas na unidade; uma vez só', { skip }, async () => {
  const { sortearBrindes, ultimoDiaSorteavel, nomeCurto } = await import('../server/routes/brindes.js');
  // Sorteável só a partir das 9h (Brasília) do dia seguinte.
  assert.equal(ultimoDiaSorteavel(Date.parse('2026-10-18T11:59:00Z')), '2026-10-16');
  assert.equal(ultimoDiaSorteavel(Date.parse('2026-10-18T12:00:00Z')), '2026-10-17');
  assert.equal(nomeCurto('Maria Souza Lima'), 'Maria L.');

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  assert.equal((await call(s.gestor, 'POST', '/api/admin/brindes', { day: today, premio: 'Boné' })).status, 403, 'gestor não cadastra');
  assert.equal((await call(s.w1, 'POST', '/api/admin/brindes', { day: today, premio: 'Boné' })).status, 403);
  assert.equal((await call(s.admin, 'POST', '/api/admin/brindes', { day: '2020-01-01', premio: 'Boné' })).status, 400, 'dia passado');
  assert.equal((await call(s.admin, 'POST', '/api/admin/brindes', { day: today, premio: '' })).status, 400, 'sem prêmio');
  assert.equal((await call(s.admin, 'POST', '/api/admin/brindes', { day: today, premio: 'Boné', unitId: 'nao-existe' })).status, 400);
  const hoje = await call(s.admin, 'POST', '/api/admin/brindes', { day: today, premio: 'Camiseta UP' });
  assert.equal(hoje.status, 201);
  assert.equal(hoje.body.status, 'AGENDADO');
  const lista = (await call(s.gestor, 'GET', `/api/manage/brindes?from=${today}&to=${today}&unitId=${s.unitA}`)).body.items;
  assert.ok(lista.some((b) => b.id === hoje.body.id), 'brinde de todas as unidades aparece no filtro da loja');
  assert.ok(lista.every((b) => !('winnerId' in b)), 'sem id do ganhador');
  // Gestor só da loja A: não consulta a loja B nem vê brinde só dela.
  const soB = await call(s.admin, 'POST', '/api/admin/brindes', { day: today, premio: 'Brinde da B', unitId: s.unitB });
  assert.equal((await call(s.gestor, 'GET', `/api/manage/brindes?from=${today}&to=${today}&unitId=${s.unitB}`)).status, 404);
  assert.ok(!(await call(s.gestor, 'GET', `/api/manage/brindes?from=${today}&to=${today}`)).body.items.some((b) => b.id === soB.body.id), 'gestor não vê brinde de outra loja');
  assert.ok((await call(s.admin, 'GET', `/api/manage/brindes?from=${today}&to=${today}`)).body.items.some((b) => b.id === soB.body.id));
  assert.equal((await call(s.admin, 'DELETE', `/api/admin/brindes/${soB.body.id}`)).status, 200);
  // O profissional vê o prêmio no dia, desde o cadastro.
  const w1 = (await userByEmail('w1@test.dev')).id;
  const est = (await call(s.admin, 'GET', `/api/manage/workers/${w1}/estrelas`)).body;
  const dia = est.months.find((m) => today.startsWith(m.month)).days[Number(today.slice(8)) - 1];
  assert.equal(dia.brindes?.[0]?.premio, 'Camiseta UP');
  await sortearBrindes(Date.now());
  assert.equal((await q('SELECT status FROM brindes WHERE id = ?', [hoje.body.id]))[0].status, 'AGENDADO', 'antes das 9h do dia seguinte não sorteia');

  // Dia isolado no passado, com dois profissionais novos: br1 com 3 estrelas na loja A, br2 com 3 estrelas na loja B.
  const [g] = await q("SELECT id FROM users WHERE email = 'gestor@test.dev'");
  const br1 = await login('br1@test.dev');
  const br2 = await login('br2@test.dev');
  await completeWorker(br1, '390.533.447-05');
  await completeWorker(br2, '987.654.321-00');
  const b1 = (await userByEmail('br1@test.dev')).id;
  const b2 = (await userByEmail('br2@test.dev')).id;
  const feita = async (worker, unit) => {
    const a = await approvedSession(worker, 'Repositor brinde');
    await q("UPDATE work_sessions SET status = 'FINALIZADA' WHERE id = ?", [a.session]);
    await q("INSERT INTO daily_confirmations (application_id, result, confirmed_by) VALUES (?, 'CONCLUIDA', ?)", [a.application, g.id]);
    await q("UPDATE jobs SET unit_id = ?, starts_at = '2020-01-15 13:00:00', ends_at = '2020-01-15 19:00:00' WHERE id = ?", [unit, a.job]);
  };
  await feita(br1, s.unitA);
  await feita(br2, s.unitB);
  const novo = async (unitId, day = '2020-01-15') => { const id = crypto.randomUUID(); await q('INSERT INTO brindes SET ?', [{ id, day, unit_id: unitId, premio: 'Boné', created_by: w1 }]); return id; };
  const bA = await novo(s.unitA);
  const bB = await novo(s.unitB);
  const bTodas = await novo(null);
  const bVazio = await novo(null, '2020-01-16');
  assert.equal((await call(s.admin, 'DELETE', `/api/admin/brindes/${hoje.body.id}`)).status, 200, 'cancela antes do sorteio');

  const http = await import('node:http');
  const sent = [];
  const mock = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { sent.push(JSON.parse(b || '{}')); res.end('{}'); }); }).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}`, EVOLUTION_API_KEY: 'chave', EVOLUTION_INSTANCE: 'upservice' });
  try {
    await q("UPDATE users SET whatsapp = '11977770001', whatsapp_verified_at = ? WHERE id = ?", [new Date(), b1]);
    await q("DELETE FROM notifications WHERE kind = 'BRINDE'");
    await sortearBrindes();
    const st = Object.fromEntries((await q('SELECT id, status, winner_user_id AS w, participants AS p FROM brindes')).map((b) => [b.id, b]));
    assert.deepEqual([st[bA].status, st[bA].w, st[bA].p], ['SORTEADO', b1, 1], 'loja A: só quem fez 3 estrelas lá');
    assert.deepEqual([st[bB].status, st[bB].w, st[bB].p], ['SORTEADO', b2, 1], 'loja B');
    assert.equal(st[bTodas].p, 2, 'todas as unidades: os dois concorrem');
    assert.ok([b1, b2].includes(st[bTodas].w));
    assert.equal(st[bVazio].status, 'SEM_PARTICIPANTES');
    assert.equal(st[hoje.body.id].status, 'CANCELADO');
    const avisos = await q("SELECT user_id, title FROM notifications WHERE kind = 'BRINDE'");
    assert.equal(avisos.length, 4, 'um aviso por participante de cada sorteio');
    assert.ok(avisos.some((a) => a.user_id === b1 && /Você ganhou o sorteio: Boné/.test(a.title)));
    for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(sent.length >= 1 && sent.every((m) => m.number === '5511977770001'), 'WhatsApp só para o ganhador com número confirmado');
    assert.match(sent[0].text, /Você ganhou o sorteio: Boné/);
    // Roda de novo: nada muda, ninguém recebe aviso de novo.
    await sortearBrindes();
    assert.equal((await q("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'BRINDE'"))[0].n, 4);
    assert.equal((await call(s.admin, 'DELETE', `/api/admin/brindes/${bA}`)).status, 409, 'sorteado não cancela');
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    mock.close();
  }
});

test('WhatsApp (bot): webhook com token, só número confirmado, vagas → candidatar, diárias → desistir, carteira; mesmas regras do app', { skip }, async () => {
  const http = await import('node:http');
  const { createHash, randomUUID } = await import('node:crypto');
  const { escolha, phoneFromJid } = await import('../server/bot.js');
  // Funções puras: número antigo sem o 9 e voto da enquete pelo nome, pelo número ou pelo hash da opção.
  assert.equal(phoneFromJid('551187654321@s.whatsapp.net'), '11987654321');
  assert.equal(phoneFromJid('5511987654321@s.whatsapp.net'), '11987654321');
  assert.equal(phoneFromJid('120363@g.us'), null);
  const labels = ['1. Procurar vagas', '2. Minhas diárias'];
  assert.equal(escolha(labels, { text: '2' }), 1);
  assert.equal(escolha(labels, { text: 'minhas diarias' }), 1);
  assert.equal(escolha(labels, { votes: ['1. Procurar vagas'] }), 0);
  assert.equal(escolha(labels, { votes: [{ type: 'Buffer', data: [...createHash('sha256').update(labels[1]).digest()] }] }), 1);
  assert.equal(escolha(labels, { text: '9' }), -1);

  const sent = [];
  let polls = 0;
  let webhook = {};
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      sent.push({ url: req.url, body: JSON.parse(b || '{}') });
      if (req.url === '/webhook/set/upservice') webhook = JSON.parse(b).webhook;
      res.end(JSON.stringify(req.url.includes('sendPoll') ? { key: { id: `poll-${++polls}` } } : req.url === '/webhook/find/upservice' ? webhook : {}));
    });
  }).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}`, EVOLUTION_API_KEY: 'chave', EVOLUTION_INSTANCE: 'upservice' });
  try {
    // Liga o atendimento: só o administrador principal; a Evolution recebe o webhook com o token.
    assert.equal((await call(s.gestor, 'PUT', '/api/admin/whatsapp/bot', { enabled: true })).status, 403);
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp/bot', { enabled: true })).status, 200);
    const set = sent.find((x) => x.url === '/webhook/set/upservice');
    assert.ok(set?.body.webhook.enabled && set.body.webhook.events.includes('MESSAGES_UPSERT'));
    // Token no cabeçalho (fora da URL, que vai para logs); com o cabeçalho guardado, token na URL não vale.
    const token = set.body.webhook.headers['x-webhook-token'];
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(new URL(set.body.webhook.url).search, '', 'token fora da URL');
    const post = (body, tk = token) => fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-token': tk }, body: JSON.stringify(body) });
    assert.equal((await post({}, 'errado')).status, 401);
    assert.equal((await call(null, 'POST', `/api/whatsapp/webhook?token=${token}`, {})).status, 401);
    // Ligado antes do cabeçalho existir (configuração sem viaHeader, webhook com o token na URL): continua atendendo.
    const [cfgRow] = await q("SELECT value FROM app_settings WHERE name = 'whatsapp_bot'");
    const { viaHeader: _, ...antiga } = JSON.parse(cfgRow.value);
    await q("UPDATE app_settings SET value = ? WHERE name = 'whatsapp_bot'", [JSON.stringify(antiga)]);
    assert.equal((await call(null, 'POST', `/api/whatsapp/webhook?token=${token}`, {})).status, 200, 'config antiga aceita o token na URL');
    assert.equal((await call(null, 'POST', '/api/whatsapp/webhook?token=errado', {})).status, 401);
    await q("UPDATE app_settings SET value = ? WHERE name = 'whatsapp_bot'", [cfgRow.value]);

    // Profissional habilitado, com o WhatsApp confirmado; uma vaga amanhã na loja A.
    const bot = await login('bot1@test.dev');
    await completeWorker(bot, '472.915.368-55');
    const me = (await userByEmail('bot1@test.dev')).id;
    await q('UPDATE users SET whatsapp = ?, whatsapp_verified_at = ? WHERE id = ?', ['11977770123', new Date(), me]);
    const amanha = new Date(Date.now() + 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const starts = new Date(`${amanha}T10:00:00-03:00`);
    const job = (await call(s.gestor, 'POST', '/api/manage/jobs', { unitId: s.unitA, title: 'Repositor do bot', startsAt: starts, endsAt: new Date(starts.getTime() + 6 * 3600e3), positions: 1, dailyValue: 130, breakCount: 1, breakMinutes: 15, publish: true })).body.id;

    // Espera a resposta chegar (até 5 s) e depois o silêncio: não depende da velocidade do banco.
    const settle = async (n0) => { for (let i = 0; i < 50 && n0 !== undefined && sent.length === n0; i++) await new Promise((r) => setTimeout(r, 100)); let n = -1; for (let i = 0; i < 60 && n !== sent.length; i++) { n = sent.length; await new Promise((r) => setTimeout(r, 300)); } };
    const msg = (jid, message) => ({ event: 'messages.upsert', instance: 'upservice', data: { key: { remoteJid: jid, fromMe: false, id: randomUUID() }, message } });
    const say = async (text, jid = '5511977770123@s.whatsapp.net') => { const n0 = sent.length; assert.equal((await post(msg(jid, { conversation: text }))).status, 200); await settle(n0); };
    const vote = async (name) => { const n0 = sent.length; await post({ event: 'messages.update', data: { keyId: `poll-${polls}`, remoteJid: '5511977770123@s.whatsapp.net', fromMe: false, pollUpdates: [{ vote: { selectedOptions: [name] } }] } }); await settle(n0); };
    const poll = () => sent.filter((x) => x.url === '/message/sendPoll/upservice').at(-1).body;
    const texts = () => sent.filter((x) => x.url === '/message/sendText/upservice').map((x) => x.body.text);
    const pick = (re) => { const i = poll().values.findIndex((v) => re.test(v)); assert.ok(i >= 0, `opção ${re} em ${poll().values}`); return String(i + 1); };

    await say('oi');
    assert.equal(poll().number, '5511977770123');
    assert.equal(poll().selectableCount, 1);
    assert.ok(poll().values.includes('1. Procurar vagas'));
    await say(pick(/Procurar vagas/));
    await vote(poll().values.find((v) => /Amanhã/.test(v))); // voto da enquete pelo nome
    assert.match(poll().name, /Vagas em/);
    await say(pick(/Repositor do bot/));
    assert.match(texts().at(-1), /Repositor do bot[\s\S]*R\$\s?130,00/);
    await say(pick(/Quero esta vaga/));
    assert.match(poll().name, /Confirma a candidatura/);
    await say(pick(/Sim/));
    assert.match(texts().at(-1), /A diária é sua/);
    const [app] = await q('SELECT id, status FROM applications WHERE job_id = ? AND user_id = ?', [job, me]);
    assert.equal(app.status, 'APROVADA', 'mesma candidatura do app');
    assert.ok((await q("SELECT 1 FROM audit_events WHERE action = 'WHATSAPP_CANDIDATURA' AND actor_id = ?", [me])).length);

    // Resposta que não está nas opções: explica e repete a pergunta.
    await say('banana');
    assert.ok(texts().some((t) => /Não entendi/.test(t)));

    // Minhas diárias → desistir (mais de 2 h antes).
    await say('menu');
    await say(pick(/Minhas diárias/));
    await say(pick(/Repositor do bot/));
    await say(pick(/Desistir desta diária/));
    await say(pick(/Sim/));
    assert.equal((await q('SELECT status FROM applications WHERE id = ?', [app.id]))[0].status, 'CANCELADA');
    await say('menu');
    await say(pick(/Minhas diárias/));
    assert.match(texts().at(-1), /não tem diárias marcadas/);

    // Carteira.
    await say('menu');
    await say(pick(/Carteira/));
    assert.match(texts().at(-1), /A receber: R\$/);

    // Número desconhecido: um aviso com o link (e só um a cada 12 h); mensagem da própria empresa é ignorada.
    const antes = sent.length;
    await say('oi', '5511900001111@s.whatsapp.net');
    assert.match(texts().at(-1), /confirme este número/);
    await say('oi de novo', '5511900001111@s.whatsapp.net');
    assert.equal(sent.length, antes + 1);
    await post({ event: 'messages.upsert', data: { key: { remoteJid: '5511977770123@s.whatsapp.net', fromMe: true, id: 'x' }, message: { conversation: 'oi' } } });
    await settle();
    assert.equal(sent.length, antes + 1, 'mensagem enviada pela própria empresa não dispara o bot');

    // Bloqueado: só o Menu restrito; opção guardada de antes do bloqueio (Carteira) volta ao Menu. Inativo não é atendido.
    await q("UPDATE users SET status = 'BLOQUEADO_TEMPORARIAMENTE' WHERE id = ?", [me]);
    await q("UPDATE whatsapp_conversas SET options = ?, updated_at = ? WHERE phone = '11977770123'", [JSON.stringify([['Carteira (pagamentos)', 'carteira']]), new Date()]);
    const n0 = texts().length;
    await say('1');
    assert.ok(!texts().slice(n0).some((t) => /A receber/.test(t)), 'bloqueado não vê a Carteira');
    assert.ok(poll().values.every((v) => !/vagas|diárias|Carteira/i.test(v)), 'menu do bloqueado sem vagas, diárias e carteira');
    await q("UPDATE users SET status = 'INATIVO' WHERE id = ?", [me]);
    await say('menu');
    assert.match(texts().at(-1), /não está ativa/);
    await q("UPDATE users SET status = 'ATIVO' WHERE id = ?", [me]);

    // Desligado: o webhook responde, mas o bot não atende.
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp/bot', { enabled: false })).status, 200);
    const n = sent.length;
    await say('menu');
    assert.equal(sent.length, n);
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    mock.close();
  }
});

test('WhatsApp (bot): lembrete da véspera com Vou/Não vou, check-in abrindo, quebra de caixa com revisão escrita, contestação e avisos', { skip }, async () => {
  const http = await import('node:http');
  const { randomUUID } = await import('node:crypto');
  const { lembretes } = await import('../server/bot.js');
  const sent = [];
  let polls = 0;
  let webhook = {};
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      sent.push({ url: req.url, body: JSON.parse(b || '{}') });
      if (req.url === '/webhook/set/upservice') webhook = JSON.parse(b).webhook;
      res.end(JSON.stringify(req.url.includes('sendPoll') ? { key: { id: `poll-${++polls}` } } : req.url === '/webhook/find/upservice' ? webhook : {}));
    });
  }).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}`, EVOLUTION_API_KEY: 'chave', EVOLUTION_INSTANCE: 'upservice' });
  try {
    assert.equal((await call(s.admin, 'PUT', '/api/admin/whatsapp/bot', { enabled: true })).status, 200);
    const token = webhook.headers['x-webhook-token'];
    const post = (body) => fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-token': token }, body: JSON.stringify(body) });
    const bot = await login('bot2@test.dev');
    await completeWorker(bot, '583.026.147-26');
    const me = (await userByEmail('bot2@test.dev')).id;
    await q('UPDATE users SET whatsapp = ?, whatsapp_verified_at = ? WHERE id = ?', ['11977770456', new Date(), me]);
    const jid = '5511977770456@s.whatsapp.net';
    // Espera a resposta chegar (até 5 s) e depois o silêncio: não depende da velocidade do banco.
    const settle = async (n0) => { for (let i = 0; i < 50 && n0 !== undefined && sent.length === n0; i++) await new Promise((r) => setTimeout(r, 100)); let n = -1; for (let i = 0; i < 60 && n !== sent.length; i++) { n = sent.length; await new Promise((r) => setTimeout(r, 300)); } };
    const say = async (text) => { const n0 = sent.length; await post({ event: 'messages.upsert', data: { key: { remoteJid: jid, fromMe: false, id: randomUUID() }, message: { conversation: text } } }); await settle(n0); };
    const poll = () => sent.filter((x) => x.url === '/message/sendPoll/upservice').at(-1).body;
    const texts = () => sent.filter((x) => x.url === '/message/sendText/upservice' && x.body.number === '5511977770456').map((x) => x.body.text);
    const pick = (re) => { const i = poll().values.findIndex((v) => re.test(v)); assert.ok(i >= 0, `opção ${re} em ${poll().values}`); return String(i + 1); };

    // Véspera: diária amanhã às 10h, pega há mais de 6 h; a varredura (às 14h de hoje) manda o lembrete com Vou / Não vou.
    const amanha = new Date(Date.now() + 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const starts = new Date(`${amanha}T10:00:00-03:00`);
    const job = (await call(s.gestor, 'POST', '/api/manage/jobs', { unitId: s.unitA, title: 'Conferente do lembrete', startsAt: starts, endsAt: new Date(starts.getTime() + 6 * 3600e3), positions: 1, dailyValue: 120, breakCount: 1, breakMinutes: 15, publish: true })).body.id;
    const app = (await call(bot, 'POST', `/api/jobs/${job}/apply`, {})).body;
    assert.equal(app.status, 'APROVADA');
    await q('UPDATE applications SET created_at = ? WHERE id = ?', [new Date(`${hoje}T07:00:00-03:00`), app.id]);
    const as14h = new Date(`${hoje}T14:00:00-03:00`);
    await lembretes(as14h);
    await settle();
    assert.match(texts().at(-1), /Lembrete da UP Service: .*Conferente do lembrete/);
    assert.equal(poll().name, 'Você vai?');
    const n1 = sent.length;
    await lembretes(as14h);
    await settle();
    assert.equal(sent.length, n1, 'lembrete vai uma vez só');
    await lembretes(new Date(`${hoje}T22:00:00-03:00`));
    await say(pick(/Não vou/));
    assert.match(poll().name, /desistir de Conferente do lembrete/);
    await say(pick(/Sim/));
    assert.equal((await q('SELECT status FROM applications WHERE id = ?', [app.id]))[0].status, 'CANCELADA');

    // Check-in abrindo (15 min antes): link direto para a tela da atividade.
    const a2 = await approvedSession(bot, 'Operador de Caixa do bot');
    await lembretes(new Date());
    await settle();
    assert.match(texts().at(-1), new RegExp(`check-in .* já está aberto[\\s\\S]*/atividade/${a2.session}`));

    // Quebra de caixa: o aviso já vem com as opções; revisão com o motivo escrito, canal WhatsApp.
    const [g] = await q("SELECT id FROM users WHERE email = 'gestor@test.dev'");
    await q("UPDATE work_sessions SET status = 'FINALIZADA' WHERE id = ?", [a2.session]);
    await q("INSERT INTO daily_confirmations (application_id, result, confirmed_by) VALUES (?, 'CONCLUIDA', ?)", [a2.application, g.id]);
    assert.equal((await call(s.gestor, 'POST', `/api/manage/applications/${a2.application}/quebra-caixa`, { amount: 20, reason: 'Faltou dinheiro no fechamento' })).status, 201);
    await settle();
    assert.match(texts().at(-1), /Quebra de caixa registrada/);
    assert.match(poll().name, /Quebras de caixa/);
    await say('1');
    await say(pick(/Pedir revisão/));
    assert.match(poll().name, /Escreva/);
    await say('Conferi o caixa com o fiscal e estava certo');
    await say(pick(/Sim, enviar/));
    assert.match(texts().at(-1), /Pedido de revisão enviado \(protocolo CT-/);
    const [rev] = await q('SELECT channel, message FROM contestations WHERE user_id = ? AND cash_break_id IS NOT NULL', [me]);
    assert.deepEqual([rev.channel, rev.message], ['WHATSAPP', 'Conferi o caixa com o fiscal e estava certo']);

    // Ocorrência confirmada → contestar pelo WhatsApp.
    assert.equal((await call(s.gestor, 'POST', '/api/manage/occurrences', { userId: me, unitId: s.unitA, type: 'REGRA_OPERACIONAL', description: 'Uso do celular no caixa' })).status, 201);
    await say('menu');
    await say(pick(/Ocorrências/));
    await say(pick(/Descumprimento de regra operacional/));
    await say(pick(/Contestar/));
    await say('curto');
    await say(pick(/Sim, enviar/));
    assert.match(texts().at(-1), /⚠️/, 'mensagem curta: a regra do app recusa e o bot explica');
    await say('menu');
    await say(pick(/Ocorrências/));
    await say(pick(/Descumprimento de regra operacional/));
    await say(pick(/Contestar/));
    await say('O gestor me pediu para atender o telefone da loja');
    await say(pick(/Sim, enviar/));
    assert.match(texts().at(-1), /Contestação enviada/);
    assert.equal((await q("SELECT channel FROM contestations WHERE user_id = ? AND occurrence_id IS NOT NULL", [me]))[0].channel, 'WHATSAPP');

    // Avisos: os do app aparecem e ficam lidos.
    await say('menu');
    await say(pick(/Avisos/));
    assert.match(texts().at(-1), /Quebra de caixa registrada/);
    assert.equal((await q('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [me]))[0].n, 0);
    await call(s.admin, 'PUT', '/api/admin/whatsapp/bot', { enabled: false });
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    mock.close();
  }
});

test('postador: grupo de cada loja (sugestão pelo nome), resumo agrupado depois de 3 min, uma vez só, sem despejar as antigas', { skip }, async () => {
  const http = await import('node:http');
  const { postarVagas, chaveNome } = await import('../server/postador.js');
  const { forgetNumber } = await import('../server/whatsapp.js');
  assert.equal(chaveNome('UP- STO ANDRÉ ESTADO'), chaveNome('Atacadão Santo André Estado'));
  assert.equal(chaveNome('UP-GRU BOM SUCESSO'), 'guarulhosbomsucesso');
  const sent = [];
  const GRUPO_A = '120363000000000001@g.us';
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      sent.push({ url: req.url, body: JSON.parse(b || '{}') });
      const out = req.url.startsWith('/group/fetchAllGroups') ? [{ id: GRUPO_A, subject: 'UP- LOJA A', size: 3 }, { id: '120363000000000009@g.us', subject: 'Repositores 1', size: 4, announce: true }]
        : req.url.startsWith('/instance/fetchInstances') ? [{ ownerJid: '5511988887777@s.whatsapp.net' }] : {};
      res.end(JSON.stringify(out));
    });
  }).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}`, EVOLUTION_API_KEY: 'chave', EVOLUTION_INSTANCE: 'upservice' });
  forgetNumber();
  const grupoMsgs = () => sent.filter((x) => x.url === '/message/sendText/upservice' && x.body.number === GRUPO_A);
  try {
    assert.equal((await call(s.gestor, 'GET', '/api/admin/postador')).status, 403, 'só o administrador principal');
    const g = (await call(s.admin, 'GET', '/api/admin/postador/grupos')).body;
    assert.equal(g.groups.length, 2);
    assert.equal(g.sugestoes[s.unitA], GRUPO_A, 'Loja A → "UP- LOJA A"');
    assert.equal((await call(s.admin, 'PUT', `/api/admin/postador/unidades/${s.unitA}`, { group: '5511999990000@s.whatsapp.net' })).status, 400, 'só grupo');
    assert.equal((await call(s.admin, 'PUT', `/api/admin/postador/unidades/${s.unitA}`, { group: GRUPO_A, groupName: 'UP- LOJA A' })).status, 200);

    const novaVaga = async (unitId, title, dias, cookie = s.admin) => {
      const starts = new Date(Date.now() + dias * 86400e3);
      return (await call(cookie, 'POST', '/api/manage/jobs', { unitId, title, startsAt: starts, endsAt: new Date(starts.getTime() + 6 * 3600e3), positions: 2, dailyValue: 125, breakCount: 1, breakMinutes: 15, publish: true })).body.id;
    };
    // Aberta antes de ligar: não vai sozinha (só no "Postar agora").
    await novaVaga(s.unitA, 'Vaga antiga do postador', 3);
    assert.equal((await call(s.admin, 'PUT', '/api/admin/postador', { enabled: true })).status, 200);
    await novaVaga(s.unitA, 'Repositor do postador', 2);
    await novaVaga(s.unitA, 'Conferente do postador', 4);
    await novaVaga(s.unitB, 'Vaga da loja sem grupo', 2);

    const now = new Date();
    await postarVagas(now);
    assert.equal(grupoMsgs().length, 0, 'espera 3 min sem vaga nova para juntar o resumo');
    await postarVagas(new Date(now.getTime() + 4 * 60e3));
    assert.equal(grupoMsgs().length, 1, 'uma mensagem por grupo');
    const msg = grupoMsgs()[0].body.text;
    assert.match(msg, /Vagas abertas · Loja A/);
    assert.match(msg, /Repositor do postador · R\$\s?125,00 · 2 vagas/);
    assert.match(msg, /Conferente do postador/);
    assert.doesNotMatch(msg, /Vaga antiga do postador/);
    assert.match(msg, /wa\.me\/5511988887777/);
    await postarVagas(new Date(now.getTime() + 8 * 60e3));
    assert.equal(grupoMsgs().length, 1, 'não posta de novo');
    assert.equal((await q("SELECT COUNT(*) AS n FROM vagas_postagens WHERE unit_id = ? AND status = 'PENDENTE'", [s.unitB]))[0].n, 1, 'loja sem grupo fica na fila');

    // "Postar agora": todas as abertas com posição livre, inclusive a antiga.
    const agora = await call(s.admin, 'POST', `/api/admin/postador/unidades/${s.unitA}/postar`, {});
    assert.ok(agora.body.postadas >= 3);
    assert.match(grupoMsgs().at(-1).body.text, /Vaga antiga do postador/);
    assert.equal((await call(s.admin, 'POST', `/api/admin/postador/unidades/${s.unitB}/postar`, {})).status, 409, 'loja sem grupo');
    assert.equal((await call(s.admin, 'PUT', '/api/admin/postador', { enabled: false })).status, 200);
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    forgetNumber();
    mock.close();
  }
});

test('WhatsApp desconectado (ou banido): o app não oferece login nem confirmação por WhatsApp', { skip }, async () => {
  const http = await import('node:http');
  const { forgetNumber } = await import('../server/whatsapp.js');
  const mock = http.createServer((req, res) => res.end(JSON.stringify(req.url.startsWith('/instance/connectionState') ? { instance: { state: 'close' } } : {}))).listen(0);
  Object.assign(process.env, { EVOLUTION_API_URL: `http://localhost:${mock.address().port}`, EVOLUTION_API_KEY: 'chave', EVOLUTION_INSTANCE: 'upservice' });
  forgetNumber();
  try {
    assert.equal((await call(null, 'GET', '/api/config')).body.phoneLogin, false, 'sem aba Telefone e sem confirmação obrigatória');
    const r = await call(null, 'POST', '/api/auth/phone/start', { phone: '11999990000' });
    assert.equal(r.status, 503);
    assert.match(r.body.error, /indisponível no momento/);
  } finally {
    for (const k of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) delete process.env[k];
    forgetNumber();
    mock.close();
  }
});

test('usuários: lista completa em páginas de 100, com o total real de cada papel (não para em 100)', { skip }, async () => {
  const { randomUUID } = await import('node:crypto');
  const extras = Array.from({ length: 130 }, (_, i) => [randomUUID(), `lista${i}@test.dev`, `Lista ${String(i).padStart(3, '0')}`]);
  await q('INSERT INTO users (id, email, name) VALUES ?', [extras]);
  try {
    const [db] = await q('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL');
    const r = (await call(s.admin, 'GET', '/api/admin/users')).body;
    assert.equal(r.counts[''], Number(db.n), 'total de todos');
    assert.equal(r.counts.PROFISSIONAL + r.counts.GESTOR + r.counts.ADMINISTRADOR, r.counts['']);
    assert.equal(r.items.length, 100, 'primeira página');
    // Todas as páginas: ninguém repetido e ninguém de fora.
    const ids = new Set(r.items.map((u) => u.id));
    for (let off = 100; off < r.total; off += 100) for (const u of (await call(s.admin, 'GET', `/api/admin/users?offset=${off}`)).body.items) ids.add(u.id);
    assert.equal(ids.size, Number(db.n));
    // Papel e busca no servidor, com o total certo.
    const prof = (await call(s.admin, 'GET', '/api/admin/users?role=PROFISSIONAL')).body;
    assert.ok(prof.items.every((u) => u.role === 'PROFISSIONAL'));
    assert.equal(prof.total, r.counts.PROFISSIONAL);
    const busca = (await call(s.admin, 'GET', '/api/admin/users?q=Lista%2012')).body;
    assert.equal(busca.total, 10, '"Lista 120" a "Lista 129"');
  } finally {
    await q('DELETE FROM users WHERE email LIKE ?', ['lista%@test.dev']);
  }
});

test('online e mensagem: último acesso gravado (no máximo 1 vez por minuto) e mensagem da gestão no app do profissional', { skip }, async () => {
  const w1 = (await userByEmail('w1@test.dev')).id;
  await q('UPDATE users SET last_seen_at = NULL WHERE id = ?', [w1]);
  await call(s.w1, 'GET', '/api/me');
  await new Promise((r) => setTimeout(r, 100));
  const [{ last_seen_at: visto }] = await q('SELECT last_seen_at FROM users WHERE id = ?', [w1]);
  assert.ok(visto && Date.now() - new Date(visto).getTime() < 10000, 'acesso grava o último acesso');
  await call(s.w1, 'GET', '/api/me');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(new Date((await q('SELECT last_seen_at FROM users WHERE id = ?', [w1]))[0].last_seen_at).getTime(), new Date(visto).getTime(), 'não regrava antes de 1 min');
  const lista = (await call(s.admin, 'GET', '/api/admin/users?q=w1@test.dev')).body.items;
  assert.ok(lista[0].lastSeenAt, 'a lista de usuários mostra o último acesso');

  // Mensagem: administrador para qualquer profissional; gestor só para os do escopo; profissional não envia.
  assert.equal((await call(s.admin, 'POST', `/api/manage/workers/${w1}/mensagem`, { texto: 'oi' })).status, 400, 'curta demais');
  assert.equal((await call(s.admin, 'POST', `/api/manage/workers/${w1}/mensagem`, { texto: 'Seu RG está ilegível, envie uma foto nova.' })).status, 201);
  assert.equal((await call(s.w2, 'POST', `/api/manage/workers/${w1}/mensagem`, { texto: 'Mensagem de outro profissional' })).status, 403);
  await login('fora-escopo@test.dev'); // sem candidatura em nenhuma loja do gestor
  const fora = (await userByEmail('fora-escopo@test.dev')).id;
  assert.equal((await call(s.gestor, 'POST', `/api/manage/workers/${fora}/mensagem`, { texto: 'Fora do meu escopo' })).status, 404);
  const [admin] = await q("SELECT id FROM users WHERE email = 'admin@test.dev'");
  assert.equal((await call(s.admin, 'POST', `/api/manage/workers/${admin.id}/mensagem`, { texto: 'Para um administrador' })).status, 404, 'só para profissional');
  const avisos = (await call(s.w1, 'GET', '/api/me/avisos')).body.items;
  const m = avisos.find((a) => a.kind === 'MENSAGEM');
  assert.match(m.title, /^Mensagem de admin · UP Service$/i);
  assert.equal(m.body, 'Seu RG está ilegível, envie uma foto nova.');
  assert.equal(m.read_at, null);
  assert.equal((await call(s.w1, 'POST', '/api/me/avisos/lidos', { ids: [m.id] })).status, 200);
  assert.ok((await call(s.w1, 'GET', '/api/me/avisos')).body.items.find((a) => a.id === m.id).read_at, '"Entendi" marca como lida');
});
