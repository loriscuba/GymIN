-- GymIN · badge "UP" sulle anagrafiche toccate dall'import abbonamenti.
-- Valorizzato dal cruscotto Import (web/js/importa.js) quando inserisce o aggiorna
-- un abbonamento del socio.
alter table soci add column if not exists aggiornato_da_import timestamptz;
