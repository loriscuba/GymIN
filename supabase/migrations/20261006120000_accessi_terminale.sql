-- GymIN · Accessi: terminale di controllo accessi (sotto-progetto /accessi)
--
-- SOLO AGGIUNTE: nessuna tabella o colonna esistente viene modificata.
--   tessere      codici RFID letti dal lettore, associati ai soci (storico conservato)
--   terminali    dispositivi autorizzati (token salvato solo come hash SHA-256)
--   accessi_log  log completo di ogni lettura (idempotente su evento_id)
-- Ogni ingresso valido scrive anche una riga in "accessi" (ingresso = 'Terminale'),
-- così la dashboard di GymIN continua a contarlo.
--
-- Sicurezza:
--   - il terminale usa SOLO la chiave anon + il proprio token: anon non ha policy RLS
--     su nessuna tabella e può eseguire soltanto le funzioni terminale_*;
--   - lo staff (utenti authenticated) legge tessere/log e scrive SOLO tramite le funzioni.
-- Si può rieseguire senza problemi.

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists tessere (
  id                    uuid primary key default gen_random_uuid(),
  codice                text not null,                     -- codice letto dal lettore (maiuscolo, senza spazi)
  socio_id              uuid not null references soci(id) on delete cascade,
  attiva                boolean not null default true,
  creato_il             timestamptz not null default now(),
  creato_da             uuid,                              -- auth.uid() dello staff
  disattivata_il        timestamptz,
  disattivata_da        uuid,
  motivo_disattivazione text
);
-- un codice può essere attivo su un solo socio; le tessere disattivate restano come storico
create unique index if not exists uq_tessere_codice_attiva on tessere(codice) where attiva;
create index if not exists idx_tessere_socio on tessere(socio_id);

create table if not exists terminali (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  token_hash      text not null unique,                    -- sha256(token) in esadecimale
  attivo          boolean not null default true,
  creato_il       timestamptz not null default now(),
  creato_da       uuid,
  ultimo_contatto timestamptz,
  ultima_sync     timestamptz
);

create table if not exists accessi_log (
  id               bigint generated always as identity primary key,
  evento_id        uuid not null unique,                   -- generato dal terminale: chiave di idempotenza
  terminale_id     uuid references terminali(id) on delete set null,
  codice           text not null,
  tessera_id       uuid references tessere(id) on delete set null,
  socio_id         uuid references soci(id) on delete set null,
  abbonamento_id   uuid references abbonamenti(id) on delete set null,
  accesso_id       uuid references accessi(id) on delete set null,   -- riga specchio in "accessi"
  esito            text not null check (esito in ('ok','negato','doppia_lettura','annullo')),
  motivo_codice    text,      -- tessera_sconosciuta | nessun_abbonamento | ingressi_esauriti | scaduto | non_ancora_attivo
  motivo           text,
  tipo_abbonamento text,      -- scadenza | ingressi
  piano            text,
  data_scadenza    date,
  giorni_rimasti   int,
  residuo_prima    int,
  residuo_dopo     int,
  ts_terminale     timestamptz,                            -- orologio del PC
  ts_server        timestamptz not null default now(),     -- ricezione sul server
  offline          boolean not null default false,         -- registrato offline e sincronizzato dopo
  da_verificare    boolean not null default false,         -- conflitto offline (vedi /gestione)
  verificato_il    timestamptz,
  verificato_da    uuid,
  nota             text,
  annullato_il     timestamptz,
  annullato_da     uuid,
  rif_log_id       bigint references accessi_log(id) on delete set null   -- per le righe 'annullo'
);
create index if not exists idx_acclog_ts on accessi_log(ts_server desc);
create index if not exists idx_acclog_socio on accessi_log(socio_id, ts_server desc);
create index if not exists idx_acclog_verificare on accessi_log(da_verificare) where da_verificare and verificato_il is null;
create index if not exists idx_acclog_sconosciute on accessi_log(codice) where motivo_codice = 'tessera_sconosciuta';

-- ---------------------------------------------------------------------------
-- RLS: lo staff legge; nessuno scrive direttamente (solo funzioni security definer)
-- ---------------------------------------------------------------------------
alter table tessere     enable row level security;
alter table terminali   enable row level security;
alter table accessi_log enable row level security;

drop policy if exists staff_read_tessere on tessere;
create policy staff_read_tessere on tessere for select to authenticated using (true);
drop policy if exists staff_read_terminali on terminali;
create policy staff_read_terminali on terminali for select to authenticated using (true);
drop policy if exists staff_read_accessi_log on accessi_log;
create policy staff_read_accessi_log on accessi_log for select to authenticated using (true);

revoke all on tessere, terminali, accessi_log from anon;
revoke insert, update, delete, truncate on tessere, terminali, accessi_log from authenticated;
-- l'hash del token non serve a nessuno: lo staff vede solo le altre colonne
revoke select on terminali from authenticated;
grant select (id, nome, attivo, creato_il, creato_da, ultimo_contatto, ultima_sync) on terminali to authenticated;
grant select on tessere, accessi_log to authenticated;

-- ---------------------------------------------------------------------------
-- Funzioni di supporto (pure)
-- ---------------------------------------------------------------------------
create or replace function accessi_normalizza_codice(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g'))
$$;

-- gg/mm se nello stesso anno di "oggi", altrimenti gg/mm/aaaa
create or replace function accessi_fmt_data(d date, oggi date) returns text
language sql immutable as $$
  select case when extract(year from d) = extract(year from oggi) then to_char(d, 'DD/MM') else to_char(d, 'DD/MM/YYYY') end
$$;

-- REGOLE DEGLI ESITI (gemella di decidiAbbonamenti() in accessi/app/js/esito.js:
-- stessi casi di test in accessi/test/casi-esito.json, verificati su entrambe).
-- p_abbonamenti: [{id, tipo: 'scadenza'|'ingressi', piano, data_inizio, data_scadenza, residuo}]
create or replace function accessi_decidi(p_abbonamenti jsonb, p_oggi date) returns jsonb
language plpgsql immutable as $$
declare
  a jsonb;
  d date;
  n int;
begin
  -- validi oggi; priorità: 'scadenza' (non consuma), poi 'ingressi' con scadenza più vicina
  select x into a
  from jsonb_array_elements(coalesce(p_abbonamenti, '[]'::jsonb)) x
  where (x->>'data_inizio')::date <= p_oggi
    and p_oggi <= (x->>'data_scadenza')::date
    and (x->>'tipo' = 'scadenza' or coalesce((x->>'residuo')::int, 0) > 0)
  order by (x->>'tipo' = 'scadenza') desc,
           case when x->>'tipo' = 'scadenza' then (date '2000-01-01' - (x->>'data_scadenza')::date)
                else ((x->>'data_scadenza')::date - date '2000-01-01') end,
           (x->>'data_inizio')::date,
           x->>'id'
  limit 1;

  if a is not null then
    n := case when a->>'tipo' = 'ingressi' then coalesce((a->>'residuo')::int, 0) end;
    return jsonb_build_object(
      'esito', 'ok', 'motivo_codice', null, 'motivo', null,
      'abbonamento_id', a->>'id', 'tipo', a->>'tipo', 'piano', a->>'piano',
      'data_scadenza', a->>'data_scadenza',
      'giorni_rimasti', (a->>'data_scadenza')::date - p_oggi,
      'residuo_prima', n, 'residuo_dopo', n - 1);
  end if;

  if jsonb_array_length(coalesce(p_abbonamenti, '[]'::jsonb)) = 0 then
    return jsonb_build_object('esito', 'negato', 'motivo_codice', 'nessun_abbonamento', 'motivo', 'Nessun abbonamento');
  end if;

  if exists (select 1 from jsonb_array_elements(p_abbonamenti) x
             where x->>'tipo' = 'ingressi'
               and (x->>'data_inizio')::date <= p_oggi and p_oggi <= (x->>'data_scadenza')::date
               and coalesce((x->>'residuo')::int, 0) <= 0) then
    return jsonb_build_object('esito', 'negato', 'motivo_codice', 'ingressi_esauriti', 'motivo', 'Ingressi esauriti');
  end if;

  select min((x->>'data_inizio')::date) into d from jsonb_array_elements(p_abbonamenti) x
  where (x->>'data_inizio')::date > p_oggi;
  if d is not null then
    return jsonb_build_object('esito', 'negato', 'motivo_codice', 'non_ancora_attivo',
      'motivo', 'Abbonamento valido dal ' || accessi_fmt_data(d, p_oggi), 'data_riferimento', d);
  end if;

  select max((x->>'data_scadenza')::date) into d from jsonb_array_elements(p_abbonamenti) x;
  return jsonb_build_object('esito', 'negato', 'motivo_codice', 'scaduto',
    'motivo', 'Abbonamento scaduto il ' || accessi_fmt_data(d, p_oggi), 'data_riferimento', d);
end $$;

-- Abbonamenti (non archiviati) di un socio nel formato di accessi_decidi
create or replace function accessi_abbonamenti_socio(p_socio uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'tipo', case when coalesce(p.entrate, 0) > 0 then 'ingressi' else 'scadenza' end,
           'piano', p.nome,
           'data_inizio', a.data_inizio,
           'data_scadenza', a.data_scadenza,
           'residuo', case when coalesce(p.entrate, 0) > 0 then coalesce(a.entrate_residue, 0) end)
         order by a.data_scadenza), '[]'::jsonb)
  from abbonamenti a join piani p on p.id = a.piano_id
  where a.socio_id = p_socio and a.stato is distinct from 'archiviato'
$$;

-- Riga di log -> esito per il terminale (usata anche per le risposte idempotenti)
create or replace function accessi_log_json(l accessi_log) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'log_id', l.id, 'evento_id', l.evento_id, 'esito', l.esito,
    'motivo_codice', l.motivo_codice, 'motivo', l.motivo,
    'socio', case when s.id is null then null else jsonb_build_object('id', s.id, 'nome', s.nome, 'cognome', s.cognome) end,
    'abbonamento_id', l.abbonamento_id, 'tipo', l.tipo_abbonamento, 'piano', l.piano,
    'data_scadenza', l.data_scadenza, 'giorni_rimasti', l.giorni_rimasti,
    'residuo_prima', l.residuo_prima, 'residuo_dopo', l.residuo_dopo,
    'offline', l.offline, 'da_verificare', l.da_verificare,
    'ts_terminale', l.ts_terminale, 'ts_server', l.ts_server, 'ora_server', now())
  from (select 1) _ left join soci s on s.id = l.socio_id
$$;

-- ---------------------------------------------------------------------------
-- Cuore: valuta + scala + registra, in UNA transazione (atomico) e idempotente su evento_id.
-- Non esposta: la chiamano terminale_accesso (online) e, in fase 2, la sincronizzazione offline.
--   p_offline          evento già avvenuto alla porta mentre il terminale era offline
--   p_esito_terminale  decisione presa dal terminale offline ({esito, motivo_codice, motivo, socio_id, ...})
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Autenticazione del terminale: token -> id (aggiorna ultimo_contatto)
-- ---------------------------------------------------------------------------
create or replace function terminale_autentica(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  update terminali set ultimo_contatto = now()
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and attivo
  returning id into v;
  if v is null then raise exception 'Terminale non autorizzato' using errcode = '28000'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- API del TERMINALE (chiave anon + token)
-- ---------------------------------------------------------------------------
create or replace function terminale_ping(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := terminale_autentica(p_token);
begin
  return jsonb_build_object('terminale_id', v, 'nome', (select nome from terminali where id = v), 'ora_server', now());
end $$;

create or replace function terminale_accesso(
  p_token text, p_codice text, p_evento_id uuid, p_ts_terminale timestamptz default null, p_doppia boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return accessi_esegui(terminale_autentica(p_token), p_codice, p_evento_id, p_ts_terminale, false, p_doppia, null);
end $$;

-- ---------------------------------------------------------------------------
-- API dello STAFF (/gestione, utenti authenticated)
-- ---------------------------------------------------------------------------
create or replace function staff_crea_terminale(p_nome text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if coalesce(trim(p_nome), '') = '' then raise exception 'Nome del terminale obbligatorio'; end if;
  insert into terminali(nome, token_hash, creato_da)
  values (trim(p_nome), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  returning id into v_id;
  -- il token in chiaro viene mostrato UNA sola volta: nel DB resta solo l'hash
  return jsonb_build_object('id', v_id, 'nome', trim(p_nome), 'token', v_token);
end $$;

create or replace function staff_revoca_terminale(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update terminali set attivo = false where id = p_id
$$;

-- Assegna un codice letto dal lettore a un socio.
--   p_modo      'aggiungi' (default) | 'sostituisci' (disattiva le altre tessere attive del socio)
--   p_conferma  necessario se il codice è già attivo su un ALTRO socio: senza, restituisce stato 'conferma'
create or replace function staff_assegna_tessera(
  p_socio_id uuid, p_codice text, p_modo text default 'aggiungi', p_conferma boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_codice text := accessi_normalizza_codice(p_codice);
  v_altra  tessere;
  v_nome   text;
  v_id     uuid;
  v_sost   int := 0;
begin
  if v_codice = '' then raise exception 'Codice tessera vuoto'; end if;
  if p_modo not in ('aggiungi', 'sostituisci') then raise exception 'Modo non valido: %', p_modo; end if;
  select nome || ' ' || cognome into v_nome from soci where id = p_socio_id;
  if v_nome is null then raise exception 'Socio non trovato'; end if;

  perform pg_advisory_xact_lock(hashtextextended('tessera:' || v_codice, 0));
  select * into v_altra from tessere where codice = v_codice and attiva;
  if found and v_altra.socio_id = p_socio_id then
    return jsonb_build_object('stato', 'gia_associata', 'tessera_id', v_altra.id, 'codice', v_codice);
  end if;
  if found then
    if not coalesce(p_conferma, false) then
      return jsonb_build_object('stato', 'conferma', 'codice', v_codice,
        'altro_socio', (select jsonb_build_object('id', id, 'nome', nome, 'cognome', cognome) from soci where id = v_altra.socio_id));
    end if;
    update tessere set attiva = false, disattivata_il = now(), disattivata_da = auth.uid(),
           motivo_disattivazione = 'Riassegnata a ' || v_nome
    where id = v_altra.id;
  end if;

  if p_modo = 'sostituisci' then
    update tessere set attiva = false, disattivata_il = now(), disattivata_da = auth.uid(),
           motivo_disattivazione = 'Sostituita'
    where socio_id = p_socio_id and attiva;
    get diagnostics v_sost = row_count;
  end if;

  insert into tessere(codice, socio_id, creato_da) values (v_codice, p_socio_id, auth.uid()) returning id into v_id;
  return jsonb_build_object('stato', 'ok', 'tessera_id', v_id, 'codice', v_codice,
    'riassegnata_da', case when v_altra.id is not null then v_altra.socio_id end, 'sostituite', v_sost);
end $$;

create or replace function staff_disattiva_tessera(p_tessera_id uuid, p_motivo text default 'Smarrita') returns void
language sql security definer set search_path = public as $$
  update tessere set attiva = false, disattivata_il = now(), disattivata_da = auth.uid(),
         motivo_disattivazione = coalesce(nullif(trim(p_motivo), ''), 'Disattivata')
  where id = p_tessera_id and attiva
$$;

-- Annulla un ingresso registrato per errore: ripristina l'ingresso scalato,
-- toglie la riga specchio da "accessi" e lascia traccia nel log (riga 'annullo').
create or replace function staff_annulla_ingresso(p_log_id bigint, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l accessi_log;
  v_ripristinato boolean := false;
  v_nuovo int;
begin
  select * into l from accessi_log where id = p_log_id for update;
  if not found then raise exception 'Ingresso non trovato'; end if;
  if l.esito <> 'ok' then raise exception 'Si possono annullare solo gli ingressi consentiti'; end if;
  if l.annullato_il is not null then raise exception 'Ingresso già annullato'; end if;

  if l.residuo_prima is not null and l.residuo_dopo is not null and l.residuo_prima > l.residuo_dopo then
    update abbonamenti set entrate_residue = coalesce(entrate_residue, 0) + (l.residuo_prima - l.residuo_dopo)
    where id = l.abbonamento_id
    returning entrate_residue into v_nuovo;
    v_ripristinato := found;
  end if;
  if l.accesso_id is not null then delete from accessi where id = l.accesso_id; end if;

  update accessi_log set annullato_il = now(), annullato_da = auth.uid() where id = l.id;
  insert into accessi_log(evento_id, terminale_id, codice, tessera_id, socio_id, abbonamento_id, esito, motivo,
                          tipo_abbonamento, piano, residuo_prima, residuo_dopo, rif_log_id)
  values (gen_random_uuid(), l.terminale_id, l.codice, l.tessera_id, l.socio_id, l.abbonamento_id, 'annullo',
          coalesce(nullif(trim(p_motivo), ''), 'Ingresso annullato dallo staff'),
          l.tipo_abbonamento, l.piano,
          case when v_ripristinato then v_nuovo - (l.residuo_prima - l.residuo_dopo) end,
          case when v_ripristinato then v_nuovo end, l.id);
  return jsonb_build_object('annullato', l.id, 'ingresso_ripristinato', v_ripristinato, 'residuo', v_nuovo);
end $$;

create or replace function staff_segna_verificato(p_log_id bigint, p_nota text default null) returns void
language sql security definer set search_path = public as $$
  update accessi_log set verificato_il = now(), verificato_da = auth.uid(), nota = coalesce(nullif(trim(p_nota), ''), nota)
  where id = p_log_id and da_verificare and verificato_il is null
$$;

-- Codici letti dal terminale ma non associati a nessuna tessera attiva
create or replace function staff_tessere_non_associate()
returns table (codice text, letture bigint, ultima_lettura timestamptz)
language sql stable security definer set search_path = public as $$
  select l.codice, count(*), max(l.ts_server)
  from accessi_log l
  where l.motivo_codice = 'tessera_sconosciuta'
    and not exists (select 1 from tessere t where t.codice = l.codice and t.attiva)
  group by l.codice
  order by max(l.ts_server) desc
$$;

-- ---------------------------------------------------------------------------
-- Permessi sulle funzioni
-- (Supabase concede EXECUTE a anon/authenticated per default: qui si restringe.)
-- ---------------------------------------------------------------------------
revoke execute on function
  accessi_esegui(uuid, text, uuid, timestamptz, boolean, boolean, jsonb),
  terminale_autentica(text),
  accessi_abbonamenti_socio(uuid),
  accessi_log_json(accessi_log)
from public, anon, authenticated;

revoke execute on function
  terminale_ping(text),
  terminale_accesso(text, text, uuid, timestamptz, boolean),
  staff_crea_terminale(text),
  staff_revoca_terminale(uuid),
  staff_assegna_tessera(uuid, text, text, boolean),
  staff_disattiva_tessera(uuid, text),
  staff_annulla_ingresso(bigint, text),
  staff_segna_verificato(bigint, text),
  staff_tessere_non_associate()
from public, anon;

grant execute on function terminale_ping(text), terminale_accesso(text, text, uuid, timestamptz, boolean) to anon, authenticated;
grant execute on function
  staff_crea_terminale(text),
  staff_revoca_terminale(uuid),
  staff_assegna_tessera(uuid, text, text, boolean),
  staff_disattiva_tessera(uuid, text),
  staff_annulla_ingresso(bigint, text),
  staff_segna_verificato(bigint, text),
  staff_tessere_non_associate()
to authenticated;
