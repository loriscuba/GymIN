// Prepara un database pulito con le migrazioni di GymIN (escluso il seed demo) + stub Supabase.
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migr = join(here, '..', '..', '..', 'supabase', 'migrations');
export const URL = process.env.TEST_DATABASE_URL;

export async function preparaDb() {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  await c.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;');
  await c.query(readFileSync(join(here, 'supabase-stub.sql'), 'utf8'));
  for (const f of readdirSync(migr).filter((x) => x.endsWith('.sql') && !x.includes('_seed')).sort()) {
    try { await c.query(readFileSync(join(migr, f), 'utf8')); } catch (e) { throw new Error(`${f}: ${e.message}`); }
  }
  await c.end();
  const pool = new pg.Pool({ connectionString: URL, max: 20 });
  return pool;
}

// Esegue fn in una transazione "come" un ruolo Supabase (anon / authenticated con un uid)
export async function come(pool, ruolo, fn, uid = '00000000-0000-0000-0000-0000000000aa') {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(ruolo === 'authenticated' ? { sub: uid, role: ruolo, email: 'staff@example.com' } : { role: ruolo })]);
    await c.query(`set local role ${ruolo}`);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
