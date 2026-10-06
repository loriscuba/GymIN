// Lettura minimale di .env (senza dipendenze) + generazione di config.js
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHIAVI = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DB_SCHEMA', 'TIMEOUT_ONLINE_MS', 'RITARDO_SUONI_MS', 'DURATA_ESITO_MS', 'CACHE_MAX_ORE', 'SYNC_INTERVALLO_MS', 'PORT', 'DEV_DATABASE_URL'];

export function leggiEnv() {
  const env = {};
  const f = join(ROOT, '.env');
  if (existsSync(f)) {
    for (const riga of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  // le variabili d'ambiente reali (es. in CI) hanno la precedenza sul file .env
  for (const k of CHIAVI) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

export function configJs(env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
  const cfg = {
    SUPABASE_URL: env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '',
    DB_SCHEMA: env.DB_SCHEMA || '',
    TIMEOUT_ONLINE_MS: num(env.TIMEOUT_ONLINE_MS, 2000),
    RITARDO_SUONI_MS: num(env.RITARDO_SUONI_MS, 150),
    DURATA_ESITO_MS: num(env.DURATA_ESITO_MS, 3000),
    CACHE_MAX_ORE: num(env.CACHE_MAX_ORE, 72),
    SYNC_INTERVALLO_MS: num(env.SYNC_INTERVALLO_MS, 60000),
  };
  return `// generato automaticamente: non modificare\nwindow.ACCESSI_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
}
