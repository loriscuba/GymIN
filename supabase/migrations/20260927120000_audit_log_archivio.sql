-- Archivio del log attività: le righe archiviate spariscono dalla vista principale
-- e finiscono nella sezione "Archivio" del Log attività. Nessun dato viene cancellato.
-- Lo staff non può modificare audit_log direttamente: archivia/ripristina solo tramite queste funzioni.
-- Si può rieseguire senza problemi.

alter table audit_log add column if not exists archiviato_il timestamptz;
create index if not exists idx_audit_archiviato on audit_log(archiviato_il);

-- archivia le righe indicate; restituisce quante righe sono state archiviate
create or replace function archivia_log(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Non autenticato'; end if;
  update audit_log set archiviato_il = now() where id = any(p_ids) and archiviato_il is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- riporta le righe indicate nella vista principale
create or replace function ripristina_log(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Non autenticato'; end if;
  update audit_log set archiviato_il = null where id = any(p_ids) and archiviato_il is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function archivia_log(bigint[]), ripristina_log(bigint[]) from public, anon;
grant execute on function archivia_log(bigint[]), ripristina_log(bigint[]) to authenticated;
