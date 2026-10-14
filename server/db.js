import mysql from 'mysql2/promise';

let pool;

export function db() {
  if (!pool) {
    pool = mysql.createPool({ uri: process.env.DATABASE_URL, timezone: 'Z', decimalNumbers: true, connectionLimit: 10 });
    // Todos os horários do banco em UTC; o servidor é o relógio oficial.
    pool.pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));
  }
  return pool;
}

export async function q(sql, params) {
  const [rows] = await db().query(sql, params);
  return rows;
}

/** Executa fn(q) numa transação; q tem a mesma assinatura do q() global. */
export async function tx(fn) {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(async (sql, params) => (await conn.query(sql, params))[0]);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
