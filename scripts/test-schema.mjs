#!/usr/bin/env node
// Genera l'SQL per creare/aggiornare lo schema di TEST ("test") nello stesso progetto Supabase.
// Prende le migrazioni di supabase/migrations e le adatta allo schema test:
//   - tutto viene creato in "test" (search_path = test), mai in "public"
//   - le funzioni con "set search_path = public" usano "test"
//   - i riferimenti espliciti 'public.' diventano 'test.'
// L'utente (auth) è condiviso tra produzione e test: stesse credenziali e stessi ruoli.
//
// Uso:
//   node scripts/test-schema.mjs                  -> tutte le migrazioni (prima installazione)
//   node scripts/test-schema.mjs 20260925140000   -> solo le migrazioni che contengono quel testo nel nome
// Copia l'output nell'SQL Editor di Supabase ed eseguilo.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'test';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const filtri = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => !filtri.length || filtri.some((x) => f.includes(x)));
if (!files.length) { console.error('Nessuna migrazione trovata per:', filtri.join(' ')); process.exit(1); }

const adatta = (sql) => sql
  .replace(/set\s+search_path\s*=\s*public\b/gi, `set search_path = ${SCHEMA}`)
  .replace(/'public\./g, `'${SCHEMA}.`)
  .replace(/\bpublic\.(?=[a-z_])/g, `${SCHEMA}.`);

const out = [
  `-- Schema di TEST "${SCHEMA}" generato da scripts/test-schema.mjs (${new Date().toISOString().slice(0, 10)})`,
  `-- Migrazioni: ${files.join(', ')}`,
  `create schema if not exists ${SCHEMA};`,
  `set search_path = ${SCHEMA};`,
  '',
];
for (const f of files) out.push(`-- ===== ${f} =====`, adatta(readFileSync(join(dir, f), 'utf8')), `set search_path = ${SCHEMA};`, '');
out.push(
  `-- ===== permessi per l'app (come per lo schema public) =====`,
  `grant usage on schema ${SCHEMA} to anon, authenticated, service_role;`,
  `grant all on all tables in schema ${SCHEMA} to authenticated, service_role;`,
  `grant all on all sequences in schema ${SCHEMA} to authenticated, service_role;`,
  `grant execute on all functions in schema ${SCHEMA} to authenticated, service_role;`,
  `alter default privileges in schema ${SCHEMA} grant all on tables to authenticated, service_role;`,
  `alter default privileges in schema ${SCHEMA} grant all on sequences to authenticated, service_role;`,
  `alter default privileges in schema ${SCHEMA} grant execute on functions to authenticated, service_role;`,
  `do $$ begin if to_regclass('${SCHEMA}.audit_log') is not null then`,
  `  revoke insert, update, delete, truncate on ${SCHEMA}.audit_log from anon, authenticated;`,
  `end if; end $$;`,
  `reset search_path;`,
  `notify pgrst, 'reload schema';`,
);
console.log(out.join('\n'));
