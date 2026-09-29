-- Log attività: registra anche ogni login al gestionale.
-- Supabase Auth aggiorna auth.users.last_sign_in_at a ogni accesso riuscito:
-- un trigger su quel campo scrive una riga in audit_log (tabella 'login', operazione 'LOGIN').
-- Si può rieseguire senza problemi.

create or replace function audit_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(utente_id, utente, tabella, operazione, record_id, dopo, azione, origine)
  values (
    new.id,
    new.email,
    'login',
    'LOGIN',
    new.id::text,
    jsonb_build_object('email', new.email, 'accesso', new.last_sign_in_at),
    'Accesso al gestionale · ' || coalesce(new.email, '?'),
    'Supabase Auth'
  );
  return null;
end $$;

drop trigger if exists audit_login on auth.users;
create trigger audit_login after update of last_sign_in_at on auth.users
  for each row when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function audit_login();
