/**
 * PostgreSQL connection pool.
 * Exports a shared Pool instance configured from DATABASE_URL.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — cannot create database pool');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

/** Test connectivity — call at startup */
export async function checkConnection(): Promise<boolean> {
  try {
    const p = getPool();
    const result = await p.query('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  } catch (err) {
    console.error('[db] Connection check failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Graceful shutdown */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
