-- Log di tutte le modifiche al database (insert / update / delete) sulle tabelle del gestionale.
-- Ogni riga registra: quando, chi (utente autenticato o ruolo di sistema, es. il mailer),
-- tabella, operazione, id del record e i dati prima/dopo (per gli update solo i campi cambiati).
-- Il log è in sola lettura per lo staff: nessuno può modificarlo o cancellarlo dall'app.

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  creato_il   timestamptz not null default now(),
  utente_id   uuid,                 -- auth.uid(); null se l'operazione arriva dal sistema (service_role / SQL)
  utente      text,                 -- email dell'utente o ruolo database
  tabella     text not null,
  operazione  text not null,        -- INSERT | UPDATE | DELETE
  record_id   text,
  prima       jsonb,                -- DELETE: record intero; UPDATE: solo i campi cambiati (valori vecchi)
  dopo        jsonb                 -- INSERT: record intero; UPDATE: solo i campi cambiati (valori nuovi)
);
create index if not exists idx_audit_data on audit_log(creato_il desc);
create index if not exists idx_audit_tab_rec on audit_log(tabella, record_id);

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rid text := coalesce(n ->> 'id', o ->> 'id');
  k text;
begin
  if tg_op = 'UPDATE' then
    -- tiene solo le colonne effettivamente cambiate
    for k in select jsonb_object_keys(n) loop
      if o -> k is not distinct from n -> k then o := o - k; n := n - k; end if;
    end loop;
    if n = '{}'::jsonb then return null; end if;   -- update senza cambiamenti: non logga
  end if;
  insert into audit_log(utente_id, utente, tabella, operazione, record_id, prima, dopo)
  values (
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), current_user),
    tg_table_name,
    tg_op,
    rid,
    o, n
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['piani','soci','abbonamenti','pagamenti','accessi','mail_log','informative_privacy','consensi_eventi'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%I on %I;', t, t);
      execute format('create trigger audit_%I after insert or update or delete on %I for each row execute function audit_trigger();', t, t);
    end if;
  end loop;
end $$;

alter table audit_log enable row level security;
drop policy if exists staff_read_audit_log on audit_log;
create policy staff_read_audit_log on audit_log for select to authenticated using (true);
revoke insert, update, delete, truncate on audit_log from anon, authenticated;
