-- GymIN · schema iniziale
-- Tabelle: piani, soci, abbonamenti, pagamenti, accessi, mail_log
-- Convenzione: nomi in italiano, id uuid, timestamp con timezone.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Piani (listino abbonamenti)
-- ---------------------------------------------------------------------------
create table if not exists piani (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  prezzo      numeric(8,2) not null,
  durata_mesi int  not null default 1,
  descrizione text,
  attivo      boolean not null default true,
  creato_il   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Soci (anagrafiche)
-- ---------------------------------------------------------------------------
create table if not exists soci (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cognome       text not null,
  email         text unique,
  telefono      text,
  data_nascita  date,
  tessera       text unique,
  consenso_mail boolean not null default false,   -- consenso comunicazioni (GDPR)
  note          text,
  creato_il     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Abbonamenti (contratti)
-- ---------------------------------------------------------------------------
create table if not exists abbonamenti (
  id            uuid primary key default gen_random_uuid(),
  socio_id      uuid not null references soci(id) on delete cascade,
  piano_id      uuid not null references piani(id),
  data_inizio   date not null default current_date,
  data_scadenza date not null,
  stato         text not null default 'attivo',   -- valore di comodo; lo stato "vivo" è calcolato (vedi view)
  creato_il     timestamptz not null default now()
);
create index if not exists idx_abb_socio on abbonamenti(socio_id);
create index if not exists idx_abb_scadenza on abbonamenti(data_scadenza);

-- ---------------------------------------------------------------------------
-- Pagamenti
-- ---------------------------------------------------------------------------
create table if not exists pagamenti (
  id              uuid primary key default gen_random_uuid(),
  abbonamento_id  uuid not null references abbonamenti(id) on delete cascade,
  importo         numeric(8,2) not null,
  metodo          text not null default 'contanti',
  data            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Accessi (check-in)
-- ---------------------------------------------------------------------------
create table if not exists accessi (
  id            uuid primary key default gen_random_uuid(),
  socio_id      uuid not null references soci(id) on delete cascade,
  ingresso      text not null default 'Reception',
  esito         text not null default 'valido',   -- valido | negato
  registrato_il timestamptz not null default now()
);
create index if not exists idx_accessi_giorno on accessi(registrato_il);

-- ---------------------------------------------------------------------------
-- Registro invii mail (evita doppioni, traccia esito)
-- ---------------------------------------------------------------------------
create table if not exists mail_log (
  id           uuid primary key default gen_random_uuid(),
  socio_id     uuid references soci(id) on delete set null,
  tipo         text not null,          -- benvenuto | ricevuta | rinnovo | scaduto | winback | compleanno | inattivita
  rif          text,                   -- chiave anti-doppione (es. "<abb_id>:7")
  destinatario text not null,
  stato        text not null default 'inviata',   -- inviata | errore
  errore       text,
  inviata_il   timestamptz not null default now()
);
create index if not exists idx_maillog_lookup on mail_log(socio_id, tipo, rif);

-- ---------------------------------------------------------------------------
-- View: stato "vivo" degli abbonamenti (attivo / in_scadenza / scaduto)
-- ---------------------------------------------------------------------------
create or replace view v_abbonamenti_stato as
select
  a.*,
  (a.data_scadenza - current_date) as giorni_residui,
  case
    when a.data_scadenza < current_date then 'scaduto'
    when a.data_scadenza <= current_date + 30 then 'in_scadenza'
    else 'attivo'
  end as stato_calcolato
from abbonamenti a;

-- ---------------------------------------------------------------------------
-- Funzioni per il mailer (la logica anti-doppione vive qui, in SQL)
-- Chiamate via supabase.rpc() dal worker con service_role.
-- ---------------------------------------------------------------------------

-- Abbonamenti che scadono ESATTAMENTE tra :giorni giorni e non ancora avvisati.
create or replace function abbonamenti_in_scadenza(giorni int)
returns table (
  socio_id       uuid,
  nome           text,
  cognome        text,
  email          text,
  abbonamento_id uuid,
  data_scadenza  date,
  piano          text
)
language sql stable as $$
  select s.id, s.nome, s.cognome, s.email, a.id, a.data_scadenza, p.nome
  from abbonamenti a
  join soci  s on s.id = a.socio_id
  join piani p on p.id = a.piano_id
  where a.data_scadenza = current_date + giorni
    and s.consenso_mail = true
    and s.email is not null
    and not exists (
      select 1 from mail_log m
      where m.socio_id = s.id
        and m.tipo = 'rinnovo'
        and m.rif  = a.id::text || ':' || giorni::text
    );
$$;

-- Abbonamenti scaduti ieri e non ancora avvisati.
create or replace function abbonamenti_scaduti()
returns table (
  socio_id       uuid,
  nome           text,
  cognome        text,
  email          text,
  abbonamento_id uuid,
  data_scadenza  date,
  piano          text
)
language sql stable as $$
  select s.id, s.nome, s.cognome, s.email, a.id, a.data_scadenza, p.nome
  from abbonamenti a
  join soci  s on s.id = a.socio_id
  join piani p on p.id = a.piano_id
  where a.data_scadenza = current_date - 1
    and s.consenso_mail = true
    and s.email is not null
    and not exists (
      select 1 from mail_log m
      where m.socio_id = s.id
        and m.tipo = 'scaduto'
        and m.rif  = a.id::text || ':scaduto'
    );
$$;

-- ---------------------------------------------------------------------------
-- RLS: app di sola gestione interna -> accesso agli utenti autenticati (staff).
-- Il mailer usa la service_role key, che bypassa RLS.
-- ---------------------------------------------------------------------------
alter table piani       enable row level security;
alter table soci        enable row level security;
alter table abbonamenti enable row level security;
alter table pagamenti   enable row level security;
alter table accessi     enable row level security;
alter table mail_log    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['piani','soci','abbonamenti','pagamenti','accessi','mail_log'] loop
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true);',
      'staff_all_' || t, t
    );
  end loop;
end $$;
