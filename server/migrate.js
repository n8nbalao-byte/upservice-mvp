import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';

const dir = new URL('./migrations/', import.meta.url);

// ponytail: DDL do MySQL não é transacional; se uma migration falhar no meio, corrigir à mão antes de rodar de novo.
export async function migrate(uri = process.env.DATABASE_URL) {
  const conn = await mysql.createConnection({ uri, multipleStatements: true });
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME NOT NULL)');
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await conn.query(await readFile(new URL(file, dir), 'utf8'));
      await conn.query('INSERT INTO schema_migrations VALUES (?, UTC_TIMESTAMP())', [file]);
      console.log('migration aplicada:', file);
    }
  } finally {
    await conn.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await migrate();
