#!/usr/bin/env node
// Carica i dati demo (sql/seed-dev.sql) nel database di SVILUPPO indicato da DEV_DATABASE_URL.
// Si rifiuta di partire su host non locali, a meno di --non-locale (es. un progetto Supabase di test).
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, leggiEnv } from './env.mjs';

const url = leggiEnv().DEV_DATABASE_URL;
if (!url) { console.error('Imposta DEV_DATABASE_URL in accessi/.env'); process.exit(1); }
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', ''].includes(host) && !process.argv.includes('--non-locale')) {
  console.error(`Host "${host}" non locale: i dati demo NON vanno mai in produzione.\nSe è un database di test usa: npm run seed:dev -- --non-locale`);
  process.exit(1);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('begin');
  await c.query(`select set_config('gymin.consenti_seed_demo', 'si', true)`);
  await c.query(readFileSync(join(ROOT, 'sql', 'seed-dev.sql'), 'utf8'));
  await c.query('commit');
  console.log('Dati demo caricati. Token del terminale di sviluppo: dev-terminale-SOLO-SVILUPPO');
} catch (e) {
  await c.query('rollback');
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
