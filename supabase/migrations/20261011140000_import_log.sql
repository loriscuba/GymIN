-- GymIN · registro delle importazioni abbonamenti.
-- Una riga per ogni abbonamento inserito/aggiornato e per ogni socio importato/collegato,
-- scritta da web/js/importlogic.js (cruscotto "Import abbonamenti" e tools/import-legacy/auto-import.mjs).
-- import_id raggruppa le righe dello stesso giro di import. Lo staff lo legge da Import abbonamenti
-- (sezione "Importazioni", filtri per data); nessuno lo modifica o lo cancella dall'app.
-- Idempotente: si può rieseguire.
create table if not exists import_log (
  id         bigint generated always as identity primary key,
  creato_il  timestamptz not null default now(),
  import_id  text not null,           -- stesso valore per tutte le righe di un giro di import
  fonte      text not null,           -- automatico | manuale
  azione     text not null,           -- nuovo | aggiornato | socio_importato | socio_collegato
  socio_id   uuid,
  cod_cli    text,
  socio      text,
  piano      text,
  prima      jsonb,                   -- aggiornato: valori precedenti dei campi cambiati
  dopo       jsonb                    -- nuovo: abbonamento inserito; aggiornato: valori nuovi
);
create index if not exists idx_import_log_data on import_log(creato_il desc);
create index if not exists idx_import_log_import on import_log(import_id);

alter table import_log enable row level security;
drop policy if exists staff_read_import_log on import_log;
create policy staff_read_import_log on import_log for select to authenticated using (true);
drop policy if exists staff_insert_import_log on import_log;
create policy staff_insert_import_log on import_log for insert to authenticated with check (true);
revoke all on import_log from anon;
grant select, insert on import_log to authenticated;
