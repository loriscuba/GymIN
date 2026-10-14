-- Allinea i DATI dello schema di test ("test") a quelli di produzione ("public").
-- Da lanciare a mano prima di una sessione di test (SQL Editor di Supabase, o chiedendolo a Claude).
--   - produzione viene solo LETTA
--   - tutto in un'unica transazione: se qualcosa fallisce, il test resta com'era
--   - si copiano solo le colonne presenti in entrambi gli schemi (il test può avere colonne nuove in prova)
--   - durante la copia i trigger del test sono spenti (niente righe finte nel log attività)
--   - i log (audit_log, mail_log, import_log) vengono svuotati e non copiati
-- Lo SCHEMA del test si aggiorna invece con scripts/test-schema.mjs.
do $$
declare
  -- ordine di copia: prima le tabelle referenziate dalle chiavi esterne
  copia text[] := array['informative_privacy', 'piani', 'app_impostazioni', 'terminali', 'soci', 'soci_da_importare',
    'tessere', 'abbonamenti', 'accessi', 'pagamenti', 'consensi_eventi', 'accessi_log'];
  svuota text[] := copia || array['audit_log', 'mail_log', 'import_log'];
  t text; cols text; col text; seq text;
begin
  foreach t in array svuota loop
    execute format('alter table test.%I disable trigger user', t);
  end loop;
  execute 'truncate ' || (select string_agg(format('test.%I', x), ', ') from unnest(svuota) x) || ' restart identity cascade';
  foreach t in array copia loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
      join information_schema.columns p on p.table_schema = 'public' and p.table_name = t and p.column_name = c.column_name
     where c.table_schema = 'test' and c.table_name = t and c.is_generated = 'NEVER';
    execute format('insert into test.%I (%s) overriding system value select %s from public.%I', t, cols, cols, t);
    -- colonne identity (es. accessi_log.id): il contatore riparte dopo l'ultimo id copiato
    for seq, col in select pg_get_serial_sequence(format('test.%I', t), column_name), column_name
        from information_schema.columns where table_schema = 'test' and table_name = t and is_identity = 'YES' loop
      execute format('select setval(%L, coalesce((select max(%I) from test.%I), 0) + 1, false)', seq, col, t);
    end loop;
  end loop;
  foreach t in array svuota loop
    execute format('alter table test.%I enable trigger user', t);
  end loop;
end $$;

-- riepilogo: righe per tabella, produzione vs test
select t as tabella,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', t), false, true, '')))[1]::text::int as produzione,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) n from test.%I', t), false, true, '')))[1]::text::int as test
from unnest(array['soci', 'piani', 'abbonamenti', 'pagamenti', 'tessere', 'accessi', 'accessi_log']) t;
