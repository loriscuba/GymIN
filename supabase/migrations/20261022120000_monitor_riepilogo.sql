-- Riepilogo per IPA Monitor (cruscotto esterno): una riga con i numeri principali della palestra.
-- Il collettore di IPA Monitor si collega con il ruolo `monitor_ro`, che vede SOLO questa vista
-- (nessun dato personale dei soci, solo conteggi e date).
--
-- Il ruolo nasce senza login. Per attivarlo, a mano dall'SQL editor (password mai nel repo):
--   alter role monitor_ro with login password '<password-lunga>';
-- Stringa per il segreto GYMIN_MONITOR_DB_URL di IPA Monitor (pooler Supabase, porta 6543):
--   postgresql://monitor_ro.aprufgirtymgadzmzjbk:<password>@<host-pooler>:6543/postgres

create schema if not exists monitor;

create or replace view monitor.riepilogo as
select
  now()                                                                              as letto_il,
  (select count(*) from public.abbonamenti where stato = 'attivo')                   as abbonamenti_attivi,
  (select count(*) from public.abbonamenti
     where stato = 'attivo' and data_scadenza between current_date and current_date + 7) as abbonamenti_in_scadenza_7g,
  (select count(*) from public.accessi
     where registrato_il >= date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome') as accessi_oggi,
  (select max(registrato_il) from public.accessi)                                    as ultimo_accesso,
  (select count(*) from public.accessi_log
     where esito = 'negato' and ts_server >= now() - interval '24 hours')            as accessi_negati_24h,
  (select count(*) from public.accessi_log where da_verificare and verificato_il is null) as accessi_da_verificare,
  (select count(*) from public.pagamenti where da_verificare)                        as pagamenti_da_verificare,
  (select count(*) from public.mail_log
     where stato = 'errore' and inviata_il >= now() - interval '24 hours')           as mail_errori_24h,
  (select max(inviata_il) from public.mail_log where stato = 'inviata')              as ultima_mail_inviata,
  (select max(creato_il) from public.import_log)                                     as ultimo_import,
  (select max(giorno) from public.report_serali)                                     as ultimo_report_serale,
  (select max(creato_il) from public.audit_log)                                      as ultima_modifica;

revoke all on schema monitor from public, anon, authenticated;
revoke all on monitor.riepilogo from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'monitor_ro') then
    create role monitor_ro nologin;
  end if;
end $$;

grant usage on schema monitor to monitor_ro;
grant select on monitor.riepilogo to monitor_ro;
