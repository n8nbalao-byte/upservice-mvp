// Apaga os dados de TESTE criados por scripts/teste-popular.mjs: contas com e-mail @teste.upservice.invalid e vagas
// com "[TESTE]" na descrição (inclusive candidaturas de profissionais reais nessas vagas), com tudo que depende delas.
// Sem --confirmar só mostra a prévia (contagens). Uso: node --env-file=<.env> scripts/teste-limpar.mjs [--confirmar]
const { q, tx, closeDb } = await import('../server/db.js');

const USERS = "SELECT id FROM users WHERE email LIKE '%@teste.upservice.invalid' AND role = 'PROFISSIONAL'";
const JOBS = "SELECT id FROM jobs WHERE description LIKE '[TESTE]%'";
const APPS = `SELECT id FROM applications WHERE job_id IN (${JOBS}) OR user_id IN (${USERS})`;
const SESS = `SELECT id FROM work_sessions WHERE application_id IN (${APPS})`;

// Ordem das chaves estrangeiras: primeiro o que depende de sessão/candidatura, por último vagas e contas.
const STEPS = [
  ['avisos', `DELETE FROM notifications WHERE user_id IN (${USERS})`],
  ['contestações', `DELETE FROM contestations WHERE user_id IN (${USERS}) OR cash_break_id IN (SELECT id FROM cash_breaks WHERE application_id IN (${APPS}))`],
  ['quebras de caixa', `DELETE FROM cash_breaks WHERE application_id IN (${APPS}) OR user_id IN (${USERS})`],
  ['pagamentos', `DELETE FROM worker_payments WHERE user_id IN (${USERS})`],
  ['ocorrências', `DELETE FROM occurrences WHERE user_id IN (${USERS}) OR application_id IN (${APPS})`],
  ['punições', `DELETE FROM penalties WHERE user_id IN (${USERS})`],
  ['exceções', `DELETE FROM presence_exceptions WHERE work_session_id IN (${SESS})`],
  ['alertas de local', `DELETE FROM location_alerts WHERE work_session_id IN (${SESS})`],
  ['tokens', `DELETE FROM event_tokens WHERE work_session_id IN (${SESS})`],
  ['registros de presença', `DELETE FROM presence_events WHERE work_session_id IN (${SESS})`],
  ['confirmações', `DELETE FROM daily_confirmations WHERE application_id IN (${APPS})`],
  ['jornadas', `DELETE FROM work_sessions WHERE application_id IN (${APPS})`],
  ['candidaturas', `DELETE FROM applications WHERE job_id IN (${JOBS}) OR user_id IN (${USERS})`],
  ['vagas', `DELETE FROM jobs WHERE description LIKE '[TESTE]%'`],
  ['brindes (ganhador)', `UPDATE brindes SET winner_user_id = NULL WHERE winner_user_id IN (${USERS})`],
  ['sessões de login', `DELETE FROM sessions WHERE user_id IN (${USERS})`],
  ['documentos', `DELETE FROM worker_documents WHERE user_id IN (${USERS})`],
  ['perfis', `DELETE FROM worker_profiles WHERE user_id IN (${USERS})`],
  ['contas', "DELETE FROM users WHERE email LIKE '%@teste.upservice.invalid' AND role = 'PROFISSIONAL'"],
];

const count = async (sql) => (await q(sql.replace(/^DELETE FROM (\w+)/, 'SELECT COUNT(*) AS n FROM $1').replace(/^UPDATE (\w+) SET [^W]+WHERE/, 'SELECT COUNT(*) AS n FROM $1 WHERE')))[0].n;
const hasTable = async (t) => (await q('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [t]))[0].n > 0;
const steps = [];
for (const [name, sql] of STEPS) if (await hasTable(sql.match(/^(?:DELETE FROM|UPDATE) (\w+)/)[1])) steps.push([name, sql]);

const preview = {};
for (const [name, sql] of steps) preview[name] = await count(sql);
console.log(JSON.stringify(preview));
if (!process.argv.includes('--confirmar')) {
  console.log('Prévia apenas. Para apagar: --confirmar');
} else {
  await tx(async (tq) => { for (const [, sql] of steps) await tq(sql); });
  console.log('Dados de teste apagados.');
}
await closeDb();
process.exit(0);
