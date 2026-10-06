#!/usr/bin/env node
// Build di produzione: copia app/ in dist/, scrive dist/config.js dalle variabili d'ambiente
// e versiona i link (__BUILD__) per invalidare le cache dei browser a ogni deploy.
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run build
import { cpSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ROOT, leggiEnv, configJs } from './env.mjs';

const DIST = join(ROOT, 'dist');
const env = leggiEnv();

// --config-gymin: se le variabili mancano, usa lo stesso progetto Supabase di GymIN (web/config.js).
// Solo per il deploy: in sviluppo non si punta mai alla produzione per sbaglio.
const cfgGymin = join(ROOT, '..', 'web', 'config.js');
if (process.argv.includes('--config-gymin') && (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) && existsSync(cfgGymin)) {
  const ctx = { window: {} };
  runInNewContext(readFileSync(cfgGymin, 'utf8'), ctx);
  const g = ctx.window.GYMIN_CONFIG || {};
  env.SUPABASE_URL ||= g.SUPABASE_URL;
  env.SUPABASE_ANON_KEY ||= g.SUPABASE_ANON_KEY;
  console.log('Supabase preso da web/config.js di GymIN.');
}
const versione = process.env.BUILD_VERSION || `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;

rmSync(DIST, { recursive: true, force: true });
cpSync(join(ROOT, 'app'), DIST, { recursive: true, filter: (p) => !p.endsWith('config.js') || p.endsWith('config.example.js') });
writeFileSync(join(DIST, 'config.js'), configJs(env));

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(DIST).filter((f) => /\.(html|js|css|webmanifest)$/.test(f))) {
  const s = readFileSync(f, 'utf8');
  if (s.includes('__BUILD__')) writeFileSync(f, s.replaceAll('__BUILD__', versione));
}
if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) console.warn('ATTENZIONE: SUPABASE_URL / SUPABASE_ANON_KEY assenti: il terminale funzionerà solo in simulazione.');
console.log(`Build ${versione} in ${DIST}`);
