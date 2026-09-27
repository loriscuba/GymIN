-- Log attività visibile solo all'amministratore (loriscuba@gmail.com).
-- Gli altri utenti staff non possono leggere audit_log né archiviare/ripristinare righe.
-- Si può rieseguire senza problemi.

create or replace function is_log_admin() returns boolean
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'loriscuba@gmail.com'
$$;

drop policy if exists staff_read_audit_log on audit_log;
drop policy if exists admin_read_audit_log on audit_log;
create policy admin_read_audit_log on audit_log for select to authenticated using (is_log_admin());

create or replace function archivia_log(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_log_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
  update audit_log set archiviato_il = now() where id = any(p_ids) and archiviato_il is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function ripristina_log(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_log_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
  update audit_log set archiviato_il = null where id = any(p_ids) and archiviato_il is not null;
  get diagnostics n = row_count;
  return n;
end $$;
