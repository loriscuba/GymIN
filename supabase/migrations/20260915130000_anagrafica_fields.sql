-- GymIN · campi anagrafica aggiuntivi sui soci
-- (nome, cognome, email, telefono, data_nascita, note, consenso_mail esistono già)

alter table soci
  add column if not exists sesso                text,   -- M | F | Altro
  add column if not exists codice_fiscale       text,
  add column if not exists indirizzo            text,
  add column if not exists citta                text,
  add column if not exists cap                  text,
  add column if not exists certificato_scadenza date;    -- scadenza certificato medico
