-- Interruttore del QR d'ingresso, nelle Impostazioni di GymIN (solo amministratore).
-- Valore in app_impostazioni, chiave qr_ingresso, {"attivo": true|false}; senza valore resta attivo.
-- Spento: i QR valgono come tessere sconosciute (online e offline: escono dallo snapshot del terminale),
-- il terminale spegne la fotocamera (lo legge da terminale_ping) e in GymIN sparisce "Invia QR d'ingresso".
-- Le tessere RFID non cambiano. Richiede la migration qr_ingresso. Si può rieseguire senza problemi.

insert into app_impostazioni (chiave, valore) values ('qr_ingresso', '{"attivo": true}') on conflict do nothing;

create or replace function accessi_qr_attivo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valore ->> 'attivo')::boolean from app_impostazioni
    where chiave = 'qr_ingresso' and valore ->> 'attivo' in ('true', 'false')), true)
$$;
revoke execute on function accessi_qr_attivo() from public, anon;

create or replace function terminale_ping(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := terminale_autentica(p_token);
begin
  return jsonb_build_object('terminale_id', v, 'nome', (select nome from terminali where id = v), 'ora_server', now(),
                            'qr_attivo', accessi_qr_attivo());
end $$;

create or replace function terminale_snapshot(p_token text, p_versione text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_term uuid := terminale_autentica(p_token);
  v_oggi date := (now() at time zone 'Europe/Rome')::date;
  v_dati jsonb;
  v_ver  text;
begin
  with t as (
    select codice, socio_id from tessere where attiva and (tipo <> 'qr' or accessi_qr_attivo())
  ), s as (
    select distinct so.id, so.nome, so.cognome from soci so join t on t.socio_id = so.id
  )
  select jsonb_build_object(
    'tessere', coalesce((select jsonb_agg(jsonb_build_object('codice', codice, 'socio_id', socio_id) order by codice) from t), '[]'::jsonb),
    'soci', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'cognome', cognome) order by id) from s), '[]'::jsonb),
    'abbonamenti', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'socio_id', a.socio_id,
               'tipo', case when coalesce(p.entrate, 0) > 0 then 'ingressi' else 'scadenza' end,
               'piano', p.nome, 'data_inizio', a.data_inizio, 'data_scadenza', a.data_scadenza,
               'residuo', case when coalesce(p.entrate, 0) > 0 then coalesce(a.entrate_residue, 0) end)
             order by a.id)
      from abbonamenti a join piani p on p.id = a.piano_id
      where a.socio_id in (select id from s)
        and a.stato is distinct from 'archiviato'
        and a.data_scadenza >= v_oggi - 60), '[]'::jsonb)
  ) into v_dati;

  -- la versione cambia anche al cambio di giorno (giorni rimasti, scadenze)
  v_ver := md5(v_dati::text || v_oggi::text);
  if p_versione is not distinct from v_ver then
    return jsonb_build_object('invariato', true, 'versione', v_ver, 'ora_server', now());
  end if;
  return v_dati || jsonb_build_object('invariato', false, 'versione', v_ver, 'ora_server', now());
end $$;

create or replace function accessi_esegui(
  p_terminale uuid, p_codice text, p_evento_id uuid, p_ts_terminale timestamptz,
  p_offline boolean default false, p_doppia boolean default false, p_esito_terminale jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_codice  text := accessi_normalizza_codice(p_codice);
  v_log     accessi_log;
  v_tessera tessere;
  v_socio   uuid;
  v_oggi    date;
  v_dec     jsonb;
  v_esito   text;
  v_verif   boolean := false;
  v_abb     uuid;
  v_prima   int;
  v_dopo    int;
  v_acc     uuid;
  v_ts_acc  timestamptz;
  v_ultimo  timestamptz;
begin
  if p_evento_id is null then raise exception 'evento_id obbligatorio'; end if;
  if v_codice = '' then raise exception 'codice tessera vuoto'; end if;

  -- stesso evento inviato due volte (timeout, retry, sync ripetuta): restituisce l'esito già registrato
  perform pg_advisory_xact_lock(hashtextextended('accessi:' || p_evento_id::text, 0));
  select * into v_log from accessi_log where evento_id = p_evento_id;
  if found then return accessi_log_json(v_log) || jsonb_build_object('duplicato', true); end if;

  -- "oggi" in Europe/Rome; per un evento offline conta il giorno in cui è avvenuto
  v_ts_acc := case when p_offline and p_ts_terminale is not null then p_ts_terminale else now() end;
  v_oggi := (v_ts_acc at time zone 'Europe/Rome')::date;

  -- con il QR d'ingresso spento da GymIN, i QR valgono come tessere sconosciute
  select * into v_tessera from tessere where codice = v_codice and attiva and (tipo <> 'qr' or accessi_qr_attivo());
  v_socio := v_tessera.socio_id;

  if p_doppia then
    -- doppia lettura entro pochi secondi: solo traccia, nessuna valutazione né scalatura
    insert into accessi_log(evento_id, terminale_id, codice, tessera_id, socio_id, esito, motivo, ts_terminale, offline)
    values (p_evento_id, p_terminale, v_codice, v_tessera.id, v_socio, 'doppia_lettura', 'Lettura ripetuta ignorata', p_ts_terminale, p_offline)
    returning * into v_log;
    return accessi_log_json(v_log) || jsonb_build_object('duplicato', false);
  end if;

  if v_tessera.id is null then
    v_dec := jsonb_build_object('esito', 'negato', 'motivo_codice', 'tessera_sconosciuta', 'motivo', 'Tessera sconosciuta');
  else
    -- blocca gli abbonamenti del socio: letture concorrenti sulla stessa tessera vengono serializzate
    perform 1 from abbonamenti where socio_id = v_socio for update;
    v_dec := accessi_decidi(accessi_abbonamenti_socio(v_socio), v_oggi);
    -- QR d'ingresso: uno screenshot si gira a un amico in un attimo -> lo stesso QR non entra
    -- due volte entro accessi_qr_blocco() (gli ingressi annullati dallo staff non contano)
    if v_dec->>'esito' = 'ok' and v_tessera.tipo = 'qr' then
      select coalesce(l.ts_terminale, l.ts_server) into v_ultimo from accessi_log l
      where l.tessera_id = v_tessera.id and l.esito = 'ok' and l.annullato_il is null
        and coalesce(l.ts_terminale, l.ts_server) > v_ts_acc - accessi_qr_blocco()
        and coalesce(l.ts_terminale, l.ts_server) <= v_ts_acc
      order by 1 desc limit 1;
      if v_ultimo is not null then
        v_dec := jsonb_build_object('esito', 'negato', 'motivo_codice', 'qr_gia_usato',
          'motivo', 'QR già usato alle ' || to_char(v_ultimo at time zone 'Europe/Rome', 'HH24:MI'));
      end if;
    end if;
  end if;
  v_esito := v_dec->>'esito';

  if p_offline and p_esito_terminale is not null then
    -- l'evento offline è già avvenuto alla porta: vale la decisione del terminale
    if p_esito_terminale->>'esito' = 'ok' and v_esito <> 'ok' then
      -- conflitto: entrato offline ma per il server non era valido -> registra, da verificare, nessuna scalatura
      v_verif := true;
      v_esito := 'ok';
      v_socio := coalesce(v_socio, nullif(p_esito_terminale->>'socio_id', '')::uuid);
      v_dec := v_dec || jsonb_build_object(
        'abbonamento_id', p_esito_terminale->'abbonamento_id', 'tipo', p_esito_terminale->'tipo',
        'piano', p_esito_terminale->'piano', 'data_scadenza', p_esito_terminale->'data_scadenza',
        'giorni_rimasti', null, 'residuo_prima', null, 'residuo_dopo', null);
    elsif p_esito_terminale->>'esito' = 'negato' then
      -- il socio è stato respinto: resta respinto, con il motivo mostrato alla porta
      v_esito := 'negato';
      v_dec := jsonb_build_object('esito', 'negato',
        'motivo_codice', p_esito_terminale->>'motivo_codice', 'motivo', p_esito_terminale->>'motivo');
    end if;
  end if;

  if v_esito = 'ok' and not v_verif then
    v_abb := (v_dec->>'abbonamento_id')::uuid;
    if v_dec->>'tipo' = 'ingressi' then
      update abbonamenti set entrate_residue = entrate_residue - 1
      where id = v_abb and entrate_residue > 0
      returning entrate_residue + 1, entrate_residue into v_prima, v_dopo;
    end if;
  elsif v_verif then
    v_abb := (select id from abbonamenti where id = nullif(v_dec->>'abbonamento_id', '')::uuid);
  end if;

  if v_esito = 'ok' and v_socio is not null then
    insert into accessi(socio_id, ingresso, esito, registrato_il)
    values (v_socio, 'Terminale', 'valido', v_ts_acc)
    returning id into v_acc;
  end if;

  insert into accessi_log(
    evento_id, terminale_id, codice, tessera_id, socio_id, abbonamento_id, accesso_id,
    esito, motivo_codice, motivo, tipo_abbonamento, piano, data_scadenza, giorni_rimasti,
    residuo_prima, residuo_dopo, ts_terminale, offline, da_verificare)
  values (
    p_evento_id, p_terminale, v_codice, v_tessera.id, v_socio, v_abb, v_acc,
    v_esito, v_dec->>'motivo_codice', v_dec->>'motivo', v_dec->>'tipo', v_dec->>'piano',
    nullif(v_dec->>'data_scadenza', '')::date, (v_dec->>'giorni_rimasti')::int,
    v_prima, v_dopo, p_ts_terminale, coalesce(p_offline, false), v_verif)
  returning * into v_log;

  return accessi_log_json(v_log) || jsonb_build_object('duplicato', false);
end $$;
