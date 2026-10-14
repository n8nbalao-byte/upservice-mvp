// Backup lógico do banco (mysqldump + gzip) em pasta privada fora do deploy (item 9 da linha de base).
// Uso manual: npm run backup. Em produção roda também dentro do app (ver index.js).
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';

const DIR = process.env.BACKUP_DIR || path.join(os.homedir(), 'upservice-backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);
const DAY_MS = 86400e3;
const LOCK = path.join(DIR, '.backup.lock');

const backups = async () => {
  const files = (await readdir(DIR).catch(() => [])).filter((f) => f.startsWith('upservice-') && f.endsWith('.sql.gz'));
  return Promise.all(files.map(async (f) => ({ file: path.join(DIR, f), mtime: (await stat(path.join(DIR, f))).mtimeMs })));
};

export async function backupDatabase() {
  const u = new URL(process.env.DATABASE_URL);
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DIR, `upservice-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sql.gz`);
  // Senha pelo ambiente do processo filho, nunca na linha de comando (visível no ps).
  const dump = spawn('mysqldump', [
    '--single-transaction', '--quick', '--no-tablespaces', '--skip-lock-tables',
    '-h', u.hostname, '-P', u.port || '3306', '-u', decodeURIComponent(u.username), decodeURIComponent(u.pathname.slice(1)),
  ], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(u.password) } });
  let stderr = '';
  dump.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((ok, err) => { dump.on('error', err); dump.on('close', ok); });
  exited.catch(() => {});
  try {
    await pipeline(dump.stdout, createGzip(), createWriteStream(file, { mode: 0o600 }));
    const code = await exited;
    if (code !== 0) throw new Error(`mysqldump saiu com código ${code}: ${stderr.trim()}`);
  } catch (e) {
    await rm(file, { force: true });
    throw e;
  }
  for (const b of await backups()) if (Date.now() - b.mtime > KEEP_DAYS * DAY_MS) await rm(b.file, { force: true });
  return file;
}

/** Chamado de hora em hora pelo app: faz backup se o último tiver mais de 24 h. */
export async function backupIfDue() {
  const list = await backups();
  if (list.length && Date.now() - Math.max(...list.map((b) => b.mtime)) < DAY_MS) return null;
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  // Trava: a hospedagem pode rodar mais de um processo do app; só um faz o backup.
  try {
    await writeFile(LOCK, String(process.pid), { flag: 'wx' });
  } catch {
    if (Date.now() - (await stat(LOCK)).mtimeMs < 3600e3) return null;
    await writeFile(LOCK, String(process.pid));
  }
  try {
    const file = await backupDatabase();
    console.log('backup do banco gravado:', path.basename(file));
    return file;
  } finally {
    await rm(LOCK, { force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await backupDatabase());
