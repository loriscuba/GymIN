-- Impostazioni del terminale d'ingresso decise da GymIN (Impostazioni dell'amministratore):
-- indirizzo dello Shelly che apre il tornello e fotocamera per i QR. Il terminale le legge con
-- terminale_ping (ogni minuto) e le ricorda nel browser per i riavvii offline: niente più ?shelly=… o
-- ?fotocamera=… nell'indirizzo. Solo aggiunte: app_impostazioni chiave terminale_ingresso.
-- Richiede le migration qr_ingresso e qr_interruttore. Si può rieseguire senza problemi.

insert into app_impostazioni (chiave, valore)
values ('terminale_ingresso', '{"shelly_url": "", "fotocamera": ""}') on conflict do nothing;

create or replace function terminale_impostazioni() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shelly_url', coalesce((select valore ->> 'shelly_url' from app_impostazioni where chiave = 'terminale_ingresso'), ''),
    'fotocamera', coalesce((select valore ->> 'fotocamera' from app_impostazioni where chiave = 'terminale_ingresso'), ''))
$$;
revoke execute on function terminale_impostazioni() from public, anon;

create or replace function terminale_ping(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := terminale_autentica(p_token);
begin
  return jsonb_build_object('terminale_id', v, 'nome', (select nome from terminali where id = v), 'ora_server', now(),
                            'qr_attivo', accessi_qr_attivo())
         || terminale_impostazioni();
end $$;
