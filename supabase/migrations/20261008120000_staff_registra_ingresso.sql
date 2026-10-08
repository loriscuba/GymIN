-- Ingresso registrato a mano dallo staff (pulsante sull'anagrafica dei soci con carnet).
-- Stesse regole del terminale (accessi_decidi), scala un'entrata e lascia traccia in
-- "accessi" e "accessi_log" (annullabile con staff_annulla_ingresso).
create or replace function staff_registra_ingresso(p_socio uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_oggi  date := (now() at time zone 'Europe/Rome')::date;
  v_dec   jsonb;
  v_esito text;
  v_abb   uuid;
  v_prima int;
  v_dopo  int;
  v_acc   uuid;
  v_log   accessi_log;
begin
  if p_socio is null then raise exception 'Socio obbligatorio'; end if;
  perform 1 from abbonamenti where socio_id = p_socio for update;
  v_dec := accessi_decidi(accessi_abbonamenti_socio(p_socio), v_oggi);
  v_esito := v_dec->>'esito';

  if v_esito = 'ok' then
    v_abb := (v_dec->>'abbonamento_id')::uuid;
    if v_dec->>'tipo' = 'ingressi' then
      update abbonamenti set entrate_residue = entrate_residue - 1
      where id = v_abb and entrate_residue > 0
      returning entrate_residue + 1, entrate_residue into v_prima, v_dopo;
    end if;
    insert into accessi(socio_id, ingresso, esito) values (p_socio, 'Reception', 'valido')
    returning id into v_acc;
  end if;

  insert into accessi_log(
    evento_id, codice, socio_id, abbonamento_id, accesso_id,
    esito, motivo_codice, motivo, tipo_abbonamento, piano, data_scadenza, giorni_rimasti,
    residuo_prima, residuo_dopo)
  values (
    gen_random_uuid(), 'manuale', p_socio, v_abb, v_acc,
    v_esito, v_dec->>'motivo_codice', v_dec->>'motivo', v_dec->>'tipo', v_dec->>'piano',
    nullif(v_dec->>'data_scadenza', '')::date, (v_dec->>'giorni_rimasti')::int,
    v_prima, v_dopo)
  returning * into v_log;

  return accessi_log_json(v_log);
end $$;

revoke execute on function staff_registra_ingresso(uuid) from public, anon;
grant execute on function staff_registra_ingresso(uuid) to authenticated;
