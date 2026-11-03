-- Orario del report serale configurabile da Impostazioni (solo amministratore).
-- L'orario sta in app_impostazioni, chiave report_ora, valore {"ora": "HH:MM"} (ora italiana);
-- senza valore resta 20:00. Il job di pg_cron gira ogni minuto e procede solo all'orario scelto.
-- Si può rieseguire senza problemi.

insert into app_impostazioni (chiave, valore) values ('report_ora', '{"ora": "20:00"}') on conflict do nothing;

create or replace function report_ora() returns time
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (valore ->> 'ora')::time from app_impostazioni
      where chiave = 'report_ora' and valore ->> 'ora' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    time '20:00')
$$;
revoke execute on function report_ora() from public, anon;

-- Stesso report di prima, con finestra: dall'orario scelto del giorno prima allo stesso orario di oggi.
create or replace function genera_report_serale(p_giorno date default (now() at time zone 'Europe/Rome')::date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_al  timestamptz := (p_giorno + report_ora()) at time zone 'Europe/Rome';
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

create or replace function report_serale_cron() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ora    timestamp := now() at time zone 'Europe/Rome';
  v_giorno date := v_ora::date;
  c report_config;
begin
  if date_trunc('minute', v_ora)::time <> report_ora() then return; end if;
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

-- Il job passa da "alle 18 e 19 UTC" a "ogni minuto" (la funzione esce subito se non è l'orario).
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('report-serale', '* * * * *', 'select report_serale_cron()');
  end if;
end $$;
