-- Report serale delle modifiche (sezione "Report" dell'app + email alle 20, ora italiana).
-- Ogni sera alle 20 (Europe/Rome) pg_cron riassume audit_log dalle 20 del giorno prima
-- alle 20 di oggi: nuovi soci, nuovi abbonamenti, pagamenti (con totale), modifiche ed
-- eliminazioni. Il riepilogo resta nella tabella report_serali (visibile solo all'amministratore,
-- come il Log attività) e, se configurata, l'Edge Function "report-serale" lo invia per email.
-- Si può rieseguire senza problemi. Configurazione email e pianificazione: vedi in fondo.

create table if not exists report_serali (
  giorno           date primary key,              -- giorno (ora italiana) a cui si riferisce
  dal              timestamptz not null,
  al               timestamptz not null,
  riepilogo        jsonb not null,
  creato_il        timestamptz not null default now(),
  letto_il         timestamptz,                  -- aperto dall'amministratore nell'app
  email_inviata_il timestamptz
);

alter table report_serali enable row level security;
drop policy if exists admin_read_report on report_serali;
create policy admin_read_report on report_serali for select to authenticated using (is_log_admin());
revoke insert, update, delete, truncate on report_serali from anon, authenticated;

-- Calcola (o ricalcola) il report del giorno indicato. Finestra: dalle 20 del giorno prima
-- alle 20 del giorno indicato, ora italiana. Esclude i log di sistema non utili (mail_log, login).
create or replace function genera_report_serale(p_giorno date default (now() at time zone 'Europe/Rome')::date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_al  timestamptz := (p_giorno::timestamp + interval '20 hours') at time zone 'Europe/Rome';
  v_dal timestamptz := v_al - interval '1 day';
  r jsonb;
begin
  -- dall'app solo l'amministratore; pg_cron / service_role non hanno un utente (auth.uid() null)
  if auth.uid() is not null and not is_log_admin() then
    raise exception 'Operazione riservata all''amministratore';
  end if;

  with l as (
    select * from audit_log
    where creato_il >= v_dal and creato_il < v_al and tabella not in ('mail_log', 'login')
  ),
  nuovi_abb as (
    select jsonb_build_object(
             'socio', trim(coalesce(s.nome, '') || ' ' || coalesce(s.cognome, '')),
             'piano', p.nome,
             'scadenza', l.dopo ->> 'data_scadenza',
             'utente', l.utente) j, l.creato_il
    from l
    left join soci s on s.id::text = l.dopo ->> 'socio_id'
    left join piani p on p.id::text = l.dopo ->> 'piano_id'
    where l.tabella = 'abbonamenti' and l.operazione = 'INSERT'
  ),
  pag as (
    select (l.dopo ->> 'importo')::numeric importo, jsonb_build_object(
             'socio', trim(coalesce(s.nome, '') || ' ' || coalesce(s.cognome, '')),
             'importo', (l.dopo ->> 'importo')::numeric,
             'metodo', l.dopo ->> 'metodo',
             'utente', l.utente) j, l.creato_il
    from l
    left join abbonamenti a on a.id::text = l.dopo ->> 'abbonamento_id'
    left join soci s on s.id = a.socio_id
    where l.tabella = 'pagamenti' and l.operazione = 'INSERT'
  )
  select jsonb_build_object(
    'totale_modifiche',      (select count(*) from l),
    'nuovi_soci',            (select count(*) from l where tabella = 'soci' and operazione = 'INSERT'),
    'soci_modificati',       (select count(distinct record_id) from l where tabella = 'soci' and operazione = 'UPDATE'),
    'nuovi_abbonamenti',     (select count(*) from nuovi_abb),
    'abbonamenti_modificati',(select count(distinct record_id) from l where tabella = 'abbonamenti' and operazione = 'UPDATE'),
    'pagamenti',             (select count(*) from pag),
    'incassato',             (select coalesce(sum(importo), 0) from pag),
    'ingressi',              (select count(*) from l where tabella = 'accessi' and operazione = 'INSERT'),
    'eliminazioni',          (select count(*) from l where operazione = 'DELETE'),
    'per_sezione',           coalesce((select jsonb_object_agg(tabella, n) from (select tabella, count(*) n from l group by 1) x), '{}'),
    'per_utente',            coalesce((select jsonb_object_agg(coalesce(utente, 'sistema'), n) from (select utente, count(*) n from l group by 1) x), '{}'),
    'elenco_abbonamenti',    coalesce((select jsonb_agg(j order by creato_il) from (select * from nuovi_abb order by creato_il limit 50) x), '[]'),
    'elenco_pagamenti',      coalesce((select jsonb_agg(j order by creato_il) from (select * from pag order by creato_il limit 50) x), '[]')
  ) into r;

  insert into report_serali(giorno, dal, al, riepilogo)
  values (p_giorno, v_dal, v_al, r)
  on conflict (giorno) do update set dal = excluded.dal, al = excluded.al, riepilogo = excluded.riepilogo, creato_il = now(), letto_il = null, email_inviata_il = null;
  return r;
end $$;
revoke execute on function genera_report_serale(date) from public, anon;

-- L'amministratore segna come letti i report (badge nella voce "Report").
create or replace function segna_report_letti() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_log_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
  update report_serali set letto_il = now() where letto_il is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function segna_report_letti() from public, anon;

-- Configurazione dell'invio email: URL dell'Edge Function report-serale e token che la protegge.
-- Il token è generato qui dal database e non esce mai dal progetto: lo leggono solo pg_cron e
-- l'Edge Function (service_role). Nessuna policy RLS = nessun accesso dall'app.
create table if not exists report_config (
  id    boolean primary key default true check (id),
  url   text,                 -- es. https://<ref>.supabase.co/functions/v1/report-serale (null = niente email)
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table report_config enable row level security;
revoke all on report_config from anon, authenticated;
insert into report_config(id) values (true) on conflict do nothing;

-- Job di pg_cron. pg_cron su Supabase lavora in UTC: il job gira alle 18 e alle 19 UTC e
-- procede solo quando in Italia sono le 20 (così regge il cambio ora legale/solare).
-- Poi, se report_config.url è impostato, chiama l'Edge Function che invia l'email.
-- Senza URL il report compare comunque nella sezione Report.
create or replace function report_serale_cron() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_giorno date := (now() at time zone 'Europe/Rome')::date;
  c report_config;
begin
  if extract(hour from now() at time zone 'Europe/Rome') <> 20 then return; end if;
  perform genera_report_serale(v_giorno);
  select * into c from report_config where id;
  if c.url is not null and to_regnamespace('net') is not null then
    perform net.http_post(
      url := c.url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-report-token', c.token),
      body := jsonb_build_object('giorno', v_giorno)
    );
  end if;
end $$;
revoke execute on function report_serale_cron() from public, anon, authenticated;

-- Attivazione (una volta, dall'SQL Editor di Supabase):
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule('report-serale', '0 18,19 * * *', 'select report_serale_cron()');
-- Email: deploy dell'Edge Function (supabase functions deploy report-serale --no-verify-jwt), poi
--   update report_config set url = 'https://<ref>.supabase.co/functions/v1/report-serale';
