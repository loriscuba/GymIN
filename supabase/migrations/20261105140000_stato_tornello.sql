-- Stato del tornello (Shelly) controllato dal terminale d'ingresso ogni 30 s.
-- Il terminale lo invia con terminale_tornello quando cambia (e comunque ogni 2 minuti);
-- GymIN lo legge da terminali per il pallino verde e l'avviso "Tornello offline".
-- Solo aggiunte. Si può rieseguire senza problemi.

alter table terminali add column if not exists tornello_ok        boolean;
alter table terminali add column if not exists tornello_errore    text;
alter table terminali add column if not exists tornello_controllo timestamptz;
grant select (tornello_ok, tornello_errore, tornello_controllo) on terminali to authenticated;

create or replace function terminale_tornello(p_token text, p_ok boolean, p_errore text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := terminale_autentica(p_token);
begin
  update terminali
     set tornello_ok = p_ok,
         tornello_errore = case when p_ok then null else left(p_errore, 500) end,
         tornello_controllo = now()
   where id = v;
end $$;
revoke execute on function terminale_tornello(text, boolean, text) from public;
grant execute on function terminale_tornello(text, boolean, text) to anon, authenticated;
