-- GymIN · privacy dei soci
--
-- 1. informative_privacy: testo dell'Informativa Privacy versionato.
--    Per aggiornarla si INSERISCE una nuova versione (le precedenti restano
--    consultabili) e la si marca attiva; mai modificare il testo di una
--    versione già pubblicata:
--      update informative_privacy set attiva = false where attiva;
--      insert into informative_privacy(versione, testo, attiva) values ('1.1', '...', true);
--
-- 2. consensi_eventi: storico append-only (niente update/delete) delle prese
--    visione dell'informativa e dei consensi/revoche marketing email.
--
-- 3. soci.privacy_* / soci.marketing_email_*: stato corrente, derivato SOLO
--    dagli eventi tramite trigger. Né l'app né l'operatore possono scriverli
--    direttamente: un update diretto su queste colonne viene ignorato.
--
-- NB: soci.consenso_mail (esistente) NON è un consenso marketing: resta il
-- flag per le comunicazioni di SERVIZIO (promemoria scadenza, ricevute).
-- Non viene migrato nel consenso marketing, che parte non prestato per tutti.

comment on column soci.consenso_mail is
  'Comunicazioni di SERVIZIO via email (promemoria scadenza, ricevute). Non è un consenso marketing.';

-- ---------------------------------------------------------------------------
-- Informativa privacy (versioni)
-- ---------------------------------------------------------------------------
create table if not exists informative_privacy (
  versione      text primary key,
  testo         text not null,
  attiva        boolean not null default false,
  pubblicata_il timestamptz not null default now()
);
-- una sola versione attiva alla volta
create unique index if not exists uq_informativa_attiva on informative_privacy(attiva) where attiva;

insert into informative_privacy(versione, attiva, testo) values ('1.0', true, $txt$
INFORMATIVA SUL TRATTAMENTO DEI DATI PERSONALI
(art. 13 Regolamento UE 2016/679 – GDPR)

1. Titolare del trattamento
[TITOLARE DEL TRATTAMENTO], con sede in [INDIRIZZO], email [EMAIL], PEC [PEC].
[DATI DEL RESPONSABILE DELLA PROTEZIONE DEI DATI (DPO), SE NOMINATO]

2. Dati trattati
Nome e cognome, numero di cellulare, indirizzo email, tipo di abbonamento e dati relativi a pagamenti e accessi alla palestra.
Non vengono raccolti dati relativi alla salute né altre categorie particolari di dati.

3. Finalità e basi giuridiche
a) Gestione dell'iscrizione, dell'abbonamento, degli accessi e dei pagamenti, incluse le comunicazioni di servizio (es. avviso di scadenza dell'abbonamento, ricevute): esecuzione del contratto (art. 6.1.b GDPR).
b) Adempimenti amministrativi, contabili e fiscali: obbligo di legge (art. 6.1.c GDPR).
c) Invio via email di comunicazioni commerciali e promozionali: solo previo consenso facoltativo, separato e revocabile in qualsiasi momento (art. 6.1.a GDPR). Il mancato consenso non ha alcuna conseguenza sull'abbonamento.

4. Modalità del trattamento e destinatari
I dati sono trattati con strumenti informatici dal personale autorizzato della palestra.
Fornitori di servizi informatici che trattano i dati per conto del Titolare: [ELENCO FORNITORI / RESPONSABILI DEL TRATTAMENTO].
[EVENTUALI TRASFERIMENTI EXTRA UE E RELATIVE GARANZIE]

5. Conservazione
Dati del rapporto: [PERIODO DI CONSERVAZIONE]. Dati per finalità promozionali: fino alla revoca del consenso o [PERIODO].

6. Diritti dell'interessato
Puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità e opporti al trattamento (artt. 15-22 GDPR) scrivendo a [EMAIL].
Puoi revocare il consenso marketing in qualsiasi momento, senza pregiudicare la liceità del trattamento precedente.
Hai diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).

Ultimo aggiornamento: [DATA]
$txt$)
on conflict (versione) do nothing;

-- ---------------------------------------------------------------------------
-- Stato corrente sul socio (derivato dagli eventi)
-- ---------------------------------------------------------------------------
alter table soci
  add column if not exists privacy_acknowledged       boolean not null default false,
  add column if not exists privacy_acknowledged_at    timestamptz,
  add column if not exists privacy_policy_version     text references informative_privacy(versione),
  add column if not exists marketing_email_consent    boolean not null default false,
  add column if not exists marketing_email_consent_at timestamptz,
  add column if not exists marketing_email_revoked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Storico eventi (append-only)
-- ---------------------------------------------------------------------------
create table if not exists consensi_eventi (
  id                  uuid primary key default gen_random_uuid(),
  socio_id            uuid not null references soci(id) on delete cascade,
  tipo                text not null,   -- informativa_privacy | marketing_email
  azione              text not null,   -- presa_visione | concesso | revocato
  versione_informativa text references informative_privacy(versione),
  testo               text,            -- testo esatto mostrato al socio (per i consensi)
  modalita            text not null,   -- socio_in_reception | socio_online | richiesta_socio
  operatore_id        uuid,            -- utente staff autenticato (auth.uid()), impostato dal DB
  registrato_il       timestamptz not null default now(),   -- impostato dal DB
  constraint ck_consensi_tipo_azione check (
    (tipo = 'informativa_privacy' and azione = 'presa_visione' and versione_informativa is not null)
    or (tipo = 'marketing_email' and azione in ('concesso', 'revocato'))
  ),
  constraint ck_consensi_modalita check (modalita in ('socio_in_reception', 'socio_online', 'richiesta_socio')),
  -- presa visione e consenso li esprime il socio in persona; l'operatore può solo
  -- registrare una revoca richiesta dal socio (revocare dev'essere sempre facile)
  constraint ck_consensi_dal_socio check (
    azione = 'revocato' or modalita in ('socio_in_reception', 'socio_online')
  )
);
create index if not exists idx_consensi_socio on consensi_eventi(socio_id, registrato_il desc);

-- Data/ora e operatore li decide il server, non il client.
create or replace function consensi_prepara() returns trigger
language plpgsql as $$
begin
  new.registrato_il := now();
  new.operatore_id  := auth.uid();
  return new;
end $$;

-- Applica l'evento allo stato corrente del socio.
create or replace function consensi_applica() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('gymin.consensi_sync', 'on', true);
  if new.tipo = 'informativa_privacy' then
    update soci set privacy_acknowledged = true,
                    privacy_acknowledged_at = new.registrato_il,
                    privacy_policy_version = new.versione_informativa
     where id = new.socio_id;
  elsif new.azione = 'concesso' then
    update soci set marketing_email_consent = true,
                    marketing_email_consent_at = new.registrato_il,
                    marketing_email_revoked_at = null
     where id = new.socio_id;
  else
    update soci set marketing_email_consent = false,
                    marketing_email_revoked_at = new.registrato_il
     where id = new.socio_id;
  end if;
  perform set_config('gymin.consensi_sync', 'off', true);
  return new;
end $$;

drop trigger if exists trg_consensi_prepara on consensi_eventi;
create trigger trg_consensi_prepara before insert on consensi_eventi
  for each row execute function consensi_prepara();
drop trigger if exists trg_consensi_applica on consensi_eventi;
create trigger trg_consensi_applica after insert on consensi_eventi
  for each row execute function consensi_applica();

-- Protegge le colonne privacy di soci: modificabili solo da consensi_applica().
create or replace function soci_proteggi_privacy() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('gymin.consensi_sync', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.privacy_acknowledged := false;
    new.privacy_acknowledged_at := null;
    new.privacy_policy_version := null;
    new.marketing_email_consent := false;
    new.marketing_email_consent_at := null;
    new.marketing_email_revoked_at := null;
  else
    new.privacy_acknowledged := old.privacy_acknowledged;
    new.privacy_acknowledged_at := old.privacy_acknowledged_at;
    new.privacy_policy_version := old.privacy_policy_version;
    new.marketing_email_consent := old.marketing_email_consent;
    new.marketing_email_consent_at := old.marketing_email_consent_at;
    new.marketing_email_revoked_at := old.marketing_email_revoked_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_soci_proteggi_privacy on soci;
create trigger trg_soci_proteggi_privacy before insert or update on soci
  for each row execute function soci_proteggi_privacy();

-- ---------------------------------------------------------------------------
-- RLS: staff autenticato legge tutto; sugli eventi può solo aggiungere.
-- Le informative si pubblicano via SQL/service_role.
-- ---------------------------------------------------------------------------
alter table informative_privacy enable row level security;
alter table consensi_eventi     enable row level security;

drop policy if exists staff_read_informative on informative_privacy;
create policy staff_read_informative on informative_privacy for select to authenticated using (true);

drop policy if exists staff_read_consensi on consensi_eventi;
create policy staff_read_consensi on consensi_eventi for select to authenticated using (true);
drop policy if exists staff_insert_consensi on consensi_eventi;
create policy staff_insert_consensi on consensi_eventi for insert to authenticated with check (true);
