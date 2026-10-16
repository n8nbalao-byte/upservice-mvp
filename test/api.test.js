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
  assert.ok(!(await call(s.admin, 'GET', '/api/admin/users')).body.some((u) => u.id === hId), 'excluído some da lista');
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

test('perfil de cores: global, só o administrador principal troca', { skip }, async () => {
  assert.equal((await call(null, 'GET', '/api/config')).body.theme, 'padrao');
  assert.equal((await call(s.gestor, 'PUT', '/api/admin/settings/theme', { theme: 'atacadao' })).status, 403);
  const a3 = await login('admin3@test.dev');
  await q("UPDATE users SET role = 'ADMINISTRADOR' WHERE email = 'admin3@test.dev'");
  assert.equal((await call(a3, 'PUT', '/api/admin/settings/theme', { theme: 'atacadao' })).status, 403, 'admin comum não troca');
  await q("UPDATE users SET is_owner = 1 WHERE email = 'admin@test.dev'");
  assert.equal((await call(s.admin, 'PUT', '/api/admin/settings/theme', { theme: 'roxo' })).status, 400);
  assert.equal((await call(s.admin, 'PUT', '/api/admin/settings/theme', { theme: 'atacadao' })).status, 200);
  assert.equal((await call(s.w1, 'GET', '/api/config')).body.theme, 'atacadao', 'vale para todos');
  assert.equal((await call(s.admin, 'PUT', '/api/admin/settings/theme', { theme: 'padrao' })).status, 200);
  const [log] = await q("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'SETTING_THEME'");
  assert.equal(Number(log.n), 2);
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
