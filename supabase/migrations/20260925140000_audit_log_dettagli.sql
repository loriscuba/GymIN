-- Log attività più leggibile: per ogni operazione salva anche
--  - azione:      descrizione in italiano di cosa è stato fatto (es. "Registrato pagamento € 10,00 · Mario Rossi")
--  - sql:         istruzione SQL eseguita (per le chiamate dall'app è la query generata dall'API;
--                 i valori passati sono in "prima"/"dopo")
--  - origine:     da dove arriva (es. "App · POST /rest/v1/pagamenti" oppure "SQL / sistema")
--  - transazione: id della transazione, per raggruppare le tabelle coinvolte nella stessa operazione
--                 (es. annullando un abbonamento vengono eliminati anche i suoi pagamenti)
-- Si può rieseguire senza problemi.

alter table audit_log add column if not exists azione      text;
alter table audit_log add column if not exists sql         text;
alter table audit_log add column if not exists origine     text;
alter table audit_log add column if not exists transazione bigint;
create index if not exists idx_audit_tx on audit_log(transazione);

create or replace function audit_socio_nome(sid uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(coalesce(nome, '') || ' ' || coalesce(cognome, '')), '') from soci where id = sid
$$;

create or replace function audit_euro(v text) returns text
language sql immutable as $$
  select '€ ' || replace(to_char(coalesce(v, '0')::numeric, 'FM999999990.00'), '.', ',')
$$;

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb;                -- record completo (nuovo, o vecchio se eliminato)
  rid text;
  k text;
  campi text;
  socio text;
  piano text;
  verbo text;
  cosa text;
  metodo_http text := nullif(current_setting('request.method', true), '');
  path_http   text := nullif(current_setting('request.path', true), '');
begin
  r := coalesce(n, o);
  rid := coalesce(r ->> 'id', r ->> 'versione');

  if tg_op = 'UPDATE' then
    -- tiene solo le colonne effettivamente cambiate
    for k in select jsonb_object_keys(n) loop
      if o -> k is not distinct from n -> k then o := o - k; n := n - k; end if;
    end loop;
    if n = '{}'::jsonb then return null; end if;   -- update senza cambiamenti: non logga
    select string_agg(x, ', ' order by x) into campi from jsonb_object_keys(n) x;
  end if;

  -- nomi leggibili di socio e piano
  socio := coalesce(
    case when tg_table_name = 'soci' then nullif(trim(coalesce(r ->> 'nome', '') || ' ' || coalesce(r ->> 'cognome', '')), '') end,
    audit_socio_nome((r ->> 'socio_id')::uuid),
    case when tg_table_name = 'pagamenti' and r ->> 'abbonamento_id' is not null then
      (select audit_socio_nome(a.socio_id) from abbonamenti a where a.id = (r ->> 'abbonamento_id')::uuid) end);
  if tg_table_name = 'abbonamenti' then
    select p.nome into piano from piani p where p.id = (r ->> 'piano_id')::uuid;
  elsif tg_table_name = 'pagamenti' and r ->> 'abbonamento_id' is not null then
    select p.nome into piano from abbonamenti a join piani p on p.id = a.piano_id where a.id = (r ->> 'abbonamento_id')::uuid;
  end if;

  verbo := case tg_op when 'INSERT' then 'Nuovo' when 'UPDATE' then 'Modificato' else 'Eliminato' end;
  cosa := case tg_table_name
    when 'soci' then
      case tg_op when 'INSERT' then 'Nuovo socio' when 'UPDATE' then 'Modificata anagrafica' else 'Eliminato socio' end
      || ' · ' || coalesce(socio, '?')
    when 'abbonamenti' then
      case tg_op when 'INSERT' then 'Attivato abbonamento' when 'UPDATE' then 'Modificato abbonamento' else 'Annullato abbonamento' end
      || ' ' || coalesce(piano, '') || ' · ' || coalesce(socio, '?')
      || case when tg_op = 'INSERT' then ' (dal ' || to_char((r ->> 'data_inizio')::date, 'DD/MM/YYYY')
                                    || ' al ' || to_char((r ->> 'data_scadenza')::date, 'DD/MM/YYYY') || ')' else '' end
    when 'pagamenti' then
      case tg_op when 'INSERT' then 'Registrato pagamento' when 'UPDATE' then 'Modificato pagamento' else 'Annullato pagamento' end
      || ' ' || audit_euro(r ->> 'importo') || ' ' || coalesce(r ->> 'metodo', '')
      || ' · ' || coalesce(socio, 'senza socio')
      || coalesce(' · ' || coalesce(r ->> 'descrizione', piano), '')
    when 'piani' then verbo || ' piano ' || coalesce(r ->> 'nome', '')
    when 'accessi' then 'Accesso ' || coalesce(r ->> 'esito', '') || ' · ' || coalesce(socio, '?') || ' · ' || coalesce(r ->> 'ingresso', '')
    when 'mail_log' then 'Email ' || coalesce(r ->> 'tipo', '') || ' a ' || coalesce(r ->> 'destinatario', '?') || ' (' || coalesce(r ->> 'stato', '') || ')'
    when 'consensi_eventi' then 'Privacy · ' || coalesce(r ->> 'tipo', '') || ' ' || coalesce(r ->> 'azione', '') || ' · ' || coalesce(socio, '?')
    when 'informative_privacy' then case tg_op when 'INSERT' then 'Nuova' when 'UPDATE' then 'Modificata' else 'Eliminata' end
      || ' informativa privacy ' || coalesce(r ->> 'versione', '')
    else verbo || ' record in ' || tg_table_name
  end;
  if campi is not null then cosa := cosa || ' — campi: ' || campi; end if;

  insert into audit_log(utente_id, utente, tabella, operazione, record_id, prima, dopo, azione, sql, origine, transazione)
  values (
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), current_user),
    tg_table_name,
    tg_op,
    rid,
    o, n,
    cosa,
    left(current_query(), 8000),
    case when metodo_http is not null then 'App · ' || metodo_http || ' ' || coalesce(path_http, '') else 'SQL / sistema (' || current_user || ')' end,
    txid_current()
  );
  return null;
end $$;
