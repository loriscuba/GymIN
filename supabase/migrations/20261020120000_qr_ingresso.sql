-- QR d'ingresso (fase 1): il socio riceve via email un QR personale e lo mostra alla fotocamera
-- del terminale. Il QR è una TESSERA come le altre (tipo 'qr'): stesse regole, stessi esiti,
-- stessa apertura porta, funziona anche offline. Solo aggiunte, idempotente.
--
--  - tessere.tipo: 'rfid' (default, tutte le tessere esistenti) | 'qr'
--  - anti-condivisione: lo stesso QR non entra due volte entro accessi_qr_blocco() (4 ore)
--  - staff_qr_socio(socio, rigenera): restituisce il QR attivo del socio (lo crea se manca);
--    rigenera = true disattiva il vecchio (es. QR finito in mani sbagliate) e ne crea uno nuovo

alter table tessere add column if not exists tipo text not null default 'rfid';
do $$ begin
  alter table tessere add constraint tessere_tipo_check check (tipo in ('rfid', 'qr'));
exception when duplicate_object then null; end $$;

create index if not exists idx_acclog_tessera_ok on accessi_log(tessera_id, ts_server desc) where esito = 'ok';

-- finestra dell'anti-condivisione per i QR (unico punto da cambiare)
create or replace function accessi_qr_blocco() returns interval
language sql immutable set search_path = public as $$ select interval '4 hours' $$;

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

  select * into v_tessera from tessere where codice = v_codice and attiva;
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

-- QR attivo del socio; lo crea se manca. Codice: 'QR' + 32 caratteri esadecimali casuali (non indovinabile).
create or replace function staff_qr_socio(p_socio_id uuid, p_rigenera boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v tessere;
begin
  if auth.uid() is null then raise exception 'Solo lo staff autenticato' using errcode = '42501'; end if;
  if not exists (select 1 from soci where id = p_socio_id) then raise exception 'Socio inesistente'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qr:' || p_socio_id::text, 0));
  if p_rigenera then
    update tessere set attiva = false, disattivata_il = now(), disattivata_da = auth.uid(),
                       motivo_disattivazione = 'QR rigenerato'
    where socio_id = p_socio_id and tipo = 'qr' and attiva;
  end if;
  select * into v from tessere where socio_id = p_socio_id and tipo = 'qr' and attiva order by creato_il desc limit 1;
  if v.id is null then
    insert into tessere(codice, socio_id, tipo, creato_da)
    values ('QR' || upper(replace(gen_random_uuid()::text, '-', '')), p_socio_id, 'qr', auth.uid())
    returning * into v;
  end if;
  return jsonb_build_object('tessera_id', v.id, 'codice', v.codice, 'creato_il', v.creato_il, 'nuovo', v.creato_il = now());
end $$;

revoke execute on function staff_qr_socio(uuid, boolean) from public, anon;
grant execute on function staff_qr_socio(uuid, boolean) to authenticated, service_role;
revoke execute on function accessi_qr_blocco() from public, anon;
revoke execute on function accessi_esegui(uuid, text, uuid, timestamptz, boolean, boolean, jsonb) from public, anon;
