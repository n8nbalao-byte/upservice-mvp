// Teste de restauração (item 9): carrega um backup num banco VAZIO separado e compara as contagens por tabela com a origem.
// Uso: RESTORE_DATABASE_URL=mysql://... node --env-file=<.env de produção> scripts/restore-check.mjs <arquivo.sql.gz>
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import mysql from 'mysql2/promise';

const [file] = process.argv.slice(2);
const source = process.env.DATABASE_URL;
const target = process.env.RESTORE_DATABASE_URL;
if (!file || !source || !target) throw new Error('Uso: RESTORE_DATABASE_URL=... DATABASE_URL=... node scripts/restore-check.mjs <backup.sql.gz>');
const t = new URL(target);
if (new URL(source).pathname === t.pathname) throw new Error('O destino não pode ser o banco de origem.');

const targetDb = await mysql.createConnection({ uri: target });
const [existing] = await targetDb.query('SHOW TABLES');
if (existing.length) throw new Error('O banco de destino precisa estar vazio.');

const load = spawn('mysql', ['-h', t.hostname, '-P', t.port || '3306', '-u', decodeURIComponent(t.username), decodeURIComponent(t.pathname.slice(1))], {
  env: { ...process.env, MYSQL_PWD: decodeURIComponent(t.password) }, stdio: ['pipe', 'inherit', 'inherit'],
});
const exited = new Promise((ok, err) => { load.on('error', err); load.on('close', ok); });
console.time('restauração');
await pipeline(createReadStream(file), createGunzip(), load.stdin);
if ((await exited) !== 0) throw new Error('mysql falhou ao carregar o backup.');
console.timeEnd('restauração');

// Compara contagens. Diferença pequena nas tabelas de log é esperada se houve uso entre o backup e a conferência.
const sourceDb = await mysql.createConnection({ uri: source });
const [tables] = await sourceDb.query('SHOW TABLES');
const rows = [];
for (const name of tables.map((x) => Object.values(x)[0])) {
  const [[a]] = await sourceDb.query('SELECT COUNT(*) AS n FROM ??', [name]);
  const [[b]] = await targetDb.query('SELECT COUNT(*) AS n FROM ??', [name]).catch(() => [[{ n: 'AUSENTE' }]]);
  rows.push({ tabela: name, origem: Number(a.n), restaurado: b.n === 'AUSENTE' ? b.n : Number(b.n), ok: Number(a.n) === Number(b.n) ? '✔' : '≠' });
}
console.table(rows);
await sourceDb.end();
await targetDb.end();
