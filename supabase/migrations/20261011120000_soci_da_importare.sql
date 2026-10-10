-- GymIN · soci del vecchio gestionale da verificare (import automatico abbonamenti).
-- tools/import-legacy/auto-import.mjs vi scrive ogni mattina i soci presenti nel vecchio
-- gestionale ma non in GymIN (nessun soci.cod_cli corrispondente), con l'anagrafica completa
-- e l'abbonamento corrente. Lo staff li importa, li collega a un socio esistente o li ignora
-- da "Import abbonamenti" (web/js/importa.js); il menu mostra quanti sono da verificare.
-- Idempotente: si può rieseguire.
create table if not exists soci_da_importare (
  cod_cli       text primary key,
  dati          jsonb not null,          -- anagrafica nel formato della tabella soci
  abbonamento   jsonb,                   -- abbonamento corrente, formato abbonamenti.csv
  stato         text not null default 'da_verificare'
                check (stato in ('da_verificare', 'importato', 'ignorato')),
  rilevato_il   timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  gestito_il    timestamptz
);
create index if not exists idx_soci_da_importare_stato on soci_da_importare(stato);

alter table soci_da_importare enable row level security;
drop policy if exists staff_soci_da_importare on soci_da_importare;
create policy staff_soci_da_importare on soci_da_importare for all to authenticated using (true) with check (true);
revoke all on soci_da_importare from anon;
grant select, insert, update, delete on soci_da_importare to authenticated;
