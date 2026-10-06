-- GymIN · Accessi fase 2: modalità OFFLINE del terminale (cache locale + coda eventi + sincronizzazione)
--
-- SOLO AGGIUNTE. Nessuna tabella o colonna di GymIN viene toccata; su "terminali"
-- (tabella del sotto-progetto Accessi, fase 1) si aggiungono due colonne.
--   terminale_snapshot   dati minimi per la cache locale (tessere attive, nome/cognome, abbonamenti)
--   terminale_sync       invio a lotti degli eventi registrati offline (idempotente su evento_id)
--   terminale_stato      il terminale comunica il proprio stato (coda, cache, orologio)
--   staff_richiedi_sync  pulsante "Sincronizza ora" in /gestione
-- Si può rieseguire senza problemi.

alter table terminali add column if not exists stato jsonb;                    -- ultimo stato inviato dal terminale
alter table terminali add column if not exists sync_richiesta_il timestamptz;  -- "Sincronizza ora" dallo staff
grant select (stato, sync_richiesta_il) on terminali to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot per la cache locale: SOLO ciò che serve a decidere e a mostrare il riepilogo.
-- Niente telefono, email, note, prezzi. Abbonamenti non archiviati, validi, futuri
-- o scaduti da al massimo 60 giorni. Se p_versione coincide restituisce solo {invariato: true}.
-- ---------------------------------------------------------------------------
create or replace function terminale_snapshot(p_token text, p_versione text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_term uuid := terminale_autentica(p_token);
  v_oggi date := (now() at time zone 'Europe/Rome')::date;
  v_dati jsonb;
  v_ver  text;
begin
  with t as (
    select codice, socio_id from tessere where attiva
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

-- ---------------------------------------------------------------------------
-- Sincronizzazione degli eventi offline, in ordine cronologico.
-- p_eventi: [{evento_id, codice, ts, doppia, esito: {esito, motivo_codice, motivo, socio_id,
--             abbonamento_id, tipo, piano, data_scadenza}, nota}]
-- Ogni evento è applicato sullo stato reale con accessi_esegui (stesse regole, stessa atomicità):
--   - evento già presente -> nessun effetto, restituisce l'esito registrato (idempotente);
--   - entrato offline ma non più valido sul server -> registrato "da verificare", residuo mai sotto zero.
-- Un evento che fallisce non blocca gli altri (resta nella coda del terminale e verrà ritentato).
-- ---------------------------------------------------------------------------
create or replace function terminale_sync(p_token text, p_eventi jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_term uuid := terminale_autentica(p_token);
  e      jsonb;
  r      jsonb;
  v_out  jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_eventi) is distinct from 'array' then raise exception 'p_eventi deve essere un array'; end if;
  if jsonb_array_length(p_eventi) > 200 then raise exception 'Massimo 200 eventi per lotto'; end if;

  for e in select x from jsonb_array_elements(p_eventi) x order by (x->>'ts')::timestamptz, x->>'evento_id' loop
    begin
      r := accessi_esegui(v_term, e->>'codice', (e->>'evento_id')::uuid, (e->>'ts')::timestamptz,
                          true, coalesce((e->>'doppia')::boolean, false), e->'esito');
      if not (r->>'duplicato')::boolean and coalesce(e->>'nota', '') <> '' then
        update accessi_log set nota = e->>'nota' where evento_id = (e->>'evento_id')::uuid;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'evento_id', e->>'evento_id', 'ok', true, 'esito', r->>'esito',
        'da_verificare', (r->>'da_verificare')::boolean, 'duplicato', (r->>'duplicato')::boolean));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('evento_id', e->>'evento_id', 'ok', false, 'errore', sqlerrm));
    end;
  end loop;

  update terminali set ultima_sync = now() where id = v_term;
  return jsonb_build_object('ora_server', now(), 'risultati', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- Stato del terminale (coda, età della cache, sfasamento orologio...) per /gestione.
-- Restituisce sync_richiesta = true una sola volta dopo "Sincronizza ora".
-- ---------------------------------------------------------------------------
create or replace function terminale_stato(p_token text, p_stato jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_term uuid := terminale_autentica(p_token);
  v_rich timestamptz;
begin
  select sync_richiesta_il into v_rich from terminali where id = v_term for update;
  update terminali
  set stato = coalesce(p_stato, '{}'::jsonb) || jsonb_build_object('ricevuto_il', now()),
      sync_richiesta_il = null
  where id = v_term;
  return jsonb_build_object('ora_server', now(), 'nome', (select nome from terminali where id = v_term),
                            'sync_richiesta', v_rich is not null);
end $$;

create or replace function staff_richiedi_sync(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update terminali set sync_richiesta_il = now() where id = p_id and attivo
$$;

-- ---------------------------------------------------------------------------
-- Permessi
-- ---------------------------------------------------------------------------
revoke execute on function
  terminale_snapshot(text, text), terminale_sync(text, jsonb), terminale_stato(text, jsonb), staff_richiedi_sync(uuid)
from public, anon;
grant execute on function terminale_snapshot(text, text), terminale_sync(text, jsonb), terminale_stato(text, jsonb) to anon, authenticated;
grant execute on function staff_richiedi_sync(uuid) to authenticated;
