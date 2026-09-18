-- GymIN · supporto import dati dal vecchio gestionale (DBF/FoxPro)
-- Aggiunge:
--   soci.provincia  -> presente nell'anagrafica legacy ma non ancora nello schema
--   soci.cod_cli    -> codice cliente del vecchio gestionale (COD_CLI):
--                      chiave naturale per collegare le tessere e ri-eseguire
--                      l'import in modo idempotente (upsert on conflict).

alter table soci
  add column if not exists provincia text,
  add column if not exists cod_cli   text;

-- Un socio per codice cliente legacy (permette upsert idempotente).
create unique index if not exists uq_soci_cod_cli on soci(cod_cli) where cod_cli is not null;
