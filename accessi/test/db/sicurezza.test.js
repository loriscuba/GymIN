// Permessi: cosa può fare chi ha solo la chiave anon (pubblica). Avvio: npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { preparaDb, come } from './helper.mjs';

let pool;
// le funzioni delle estensioni (es. pgcrypto) sono escluse: in Supabase stanno nello schema extensions
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);

before(async () => { pool = await preparaDb(); });
after(async () => { await pool?.end(); });

test('anon non legge né modifica la vista v_abbonamenti_stato', async () => {
  await assert.rejects(come(pool, 'anon', (c) => c.query('select * from v_abbonamenti_stato')), /permission denied/);
  await assert.rejects(come(pool, 'anon', (c) => c.query('delete from v_abbonamenti_stato')), /permission denied/);
});

test('la vista rispetta la RLS (security_invoker)', async () => {
  const [{ opts }] = await q(`select array_to_string(reloptions, ',') opts from pg_class where relname = 'v_abbonamenti_stato'`);
  assert.match(opts, /security_invoker=true/);
});

test('anon esegue solo le funzioni del terminale', async () => {
  const righe = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1`);
  const nomi = righe.map((r) => r.proname);
  assert.ok(nomi.length > 0, 'le funzioni del terminale devono restare eseguibili');
  assert.deepEqual(nomi.filter((n) => !n.startsWith('terminale_')), []);
});

test('lo staff mantiene le sue funzioni', async () => {
  for (const f of ['staff_registra_ingresso(uuid)', 'staff_assegna_tessera(uuid,text,text,boolean)', 'abbonamenti_scaduti()']) {
    const [{ ok }] = await q(`select has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') ok`, [f]);
    assert.equal(ok, true, f);
  }
});

test('tutte le funzioni hanno search_path fisso', async () => {
  const righe = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(righe.map((r) => r.proname), []);
});
