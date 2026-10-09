-- GymIN · sicurezza: chiude gli accessi anonimi rimasti aperti (avvisi del Security Advisor di Supabase).
--
-- La chiave "anon" è pubblica (è nel sito), quindi tutto ciò che "anon" può fare
-- lo può fare chiunque su Internet. Questa migration:
--
-- 1. v_abbonamenti_stato: la vista girava con i permessi del proprietario (SECURITY DEFINER
--    implicito) e quindi IGNORAVA la RLS; in più "anon" aveva SELECT/INSERT/UPDATE/DELETE.
--    Ora gira con i permessi di chi interroga (security_invoker) e "anon" non la vede più.
-- 2. Funzioni: "anon" (e PUBLIC) non possono più eseguire le funzioni del gestionale.
--    Restano pubbliche solo le terminale_* (il terminale d'ingresso non ha login:
--    sono protette dal token del terminale, salvato come hash).
--    Lo staff (authenticated) e service_role (mailer, import) mantengono i permessi attuali.
-- 3. search_path fissato sulle funzioni che non lo avevano (avviso "Function Search Path Mutable").
-- 4. Default: le funzioni create in futuro non sono eseguibili da anon/PUBLIC
--    se non con un GRANT esplicito (come già fanno le migration delle terminale_*).
--
-- Vale per lo schema public e, se esiste, per lo schema test (ambiente di test).
-- Idempotente: si può rieseguire.

do $$
declare
  sch text;
  f record;
begin
  foreach sch in array array['public', 'test'] loop
    if not exists (select 1 from pg_namespace where nspname = sch) then continue; end if;

    -- 1. vista
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = sch and c.relname = 'v_abbonamenti_stato' and c.relkind = 'v') then
      execute format('alter view %I.v_abbonamenti_stato set (security_invoker = true)', sch);
      execute format('revoke all on %I.v_abbonamenti_stato from anon', sch);
    end if;

    for f in
      select p.oid, p.oid::regprocedure::text as firma, p.proname, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = sch and p.prokind = 'f'
         -- solo funzioni nostre (non quelle delle estensioni)
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    loop
      -- 3. search_path fisso
      if f.proconfig is null or not exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%') then
        execute format('alter function %s set search_path = %I', f.firma, sch);
      end if;

      -- 2. niente esecuzione anonima, tranne il terminale d'ingresso
      if f.proname not like 'terminale\_%' then
        if has_function_privilege('authenticated', f.oid, 'EXECUTE') then
          execute format('grant execute on function %s to authenticated', f.firma);
        end if;
        if has_function_privilege('service_role', f.oid, 'EXECUTE') then
          execute format('grant execute on function %s to service_role', f.firma);
        end if;
        execute format('revoke execute on function %s from public, anon', f.firma);
      end if;
    end loop;

    -- 4. default per le funzioni future
    execute format('alter default privileges in schema %I revoke execute on functions from public, anon', sch);
    execute format('alter default privileges in schema %I grant execute on functions to authenticated, service_role', sch);
  end loop;
end $$;
