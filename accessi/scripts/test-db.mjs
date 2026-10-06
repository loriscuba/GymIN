#!/usr/bin/env node
// Test delle funzioni SQL su un Postgres VERO (atomicità, concorrenza, idempotenza, permessi).
// - Se TEST_DATABASE_URL è impostata usa quel database (verrà AZZERATO: usa un DB usa-e-getta!).
// - Altrimenti avvia un cluster Postgres temporaneo locale (serve Postgres installato: initdb/pg_ctl).
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, chownSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (env) => spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/db/*.test.js'], { stdio: 'inherit', env: { ...process.env, ...env } }).status;

if (process.env.TEST_DATABASE_URL) process.exit(run({}));

let bin;
try { bin = execFileSync('pg_config', ['--bindir']).toString().trim(); } catch { /* pg_config assente */ }
if (!bin || !existsSync(join(bin, 'initdb'))) {
  console.error('Postgres non trovato: installalo oppure imposta TEST_DATABASE_URL (DB usa-e-getta).');
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'accessi-pg-'));
const asRoot = process.getuid?.() === 0;
// initdb non gira come root: in quel caso usa l'utente di sistema "postgres"
const pgUser = asRoot ? 'postgres' : null;
if (asRoot) {
  const uid = Number(execFileSync('id', ['-u', 'postgres']).toString());
  const gid = Number(execFileSync('id', ['-g', 'postgres']).toString());
  chownSync(dir, uid, gid);
}
const sh = (cmd, args) => {
  const full = pgUser ? ['runuser', ['-u', pgUser, '--', join(bin, cmd), ...args]] : [join(bin, cmd), args];
  return spawnSync(full[0], full[1], { stdio: ['ignore', 'ignore', 'inherit'] }).status;
};
const port = 54000 + Math.floor(Math.random() * 900);
const data = join(dir, 'data');
let status = 1;
try {
  if (sh('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--locale=C', '-E', 'UTF8'])) throw new Error('initdb fallito');
  if (sh('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-w', '-l', join(dir, 'log'), 'start'])) throw new Error('avvio Postgres fallito');
  status = run({ TEST_DATABASE_URL: `postgresql://postgres@/postgres?host=${encodeURIComponent(dir)}&port=${port}` });
} catch (e) {
  console.error(e.message);
} finally {
  sh('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
