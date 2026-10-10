-- GymIN · impostazioni condivise dell'app (valgono per tutti i PC e tutti gli utenti).
-- Chiave "sezioni_staff": sezioni/menu nascosti agli utenti diversi dall'amministratore
-- (is_log_admin, loriscuba@gmail.com), che vede sempre tutto. Le legge ogni utente staff,
-- le modifica solo l'amministratore da Impostazioni (web/js/app.js).
-- Nasconde solo l'interfaccia: i permessi sui dati non cambiano.
-- Idempotente: si può rieseguire.
create table if not exists app_impostazioni (
  chiave        text primary key,
  valore        jsonb not null,
  aggiornato_il timestamptz not null default now()
);
alter table app_impostazioni enable row level security;
drop policy if exists staff_read_impostazioni on app_impostazioni;
create policy staff_read_impostazioni on app_impostazioni for select to authenticated using (true);
drop policy if exists admin_write_impostazioni on app_impostazioni;
create policy admin_write_impostazioni on app_impostazioni for all to authenticated using (is_log_admin()) with check (is_log_admin());
revoke all on app_impostazioni from anon;
grant select, insert, update, delete on app_impostazioni to authenticated;

-- di partenza: Tessere e "Ultimi 10 ingressi" della dashboard nascosti agli altri utenti
insert into app_impostazioni (chiave, valore) values ('sezioni_staff', '{"nascoste": ["tessere", "ingressi"]}')
on conflict (chiave) do nothing;
