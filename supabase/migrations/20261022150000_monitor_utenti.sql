-- Utenti online per IPA Monitor: l'app staff manda un segnale ogni minuto (monitor_segnale) mentre la scheda è
-- visibile; la vista monitor.utenti unisce i segnali all'ultimo login di Supabase Auth.
-- Il ruolo monitor_ro legge solo la vista (email e date dello staff, nessun dato dei soci).

create table if not exists monitor.presenze (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  ultimo_segnale  timestamptz not null default now()
);
revoke all on monitor.presenze from public, anon, authenticated;

create or replace function public.monitor_segnale() returns void
language sql security definer set search_path = '' as $$
  insert into monitor.presenze (user_id)
  select auth.uid() where auth.uid() is not null
  on conflict (user_id) do update set ultimo_segnale = now();
$$;
revoke all on function public.monitor_segnale() from public, anon;
grant execute on function public.monitor_segnale() to authenticated;

-- ultima_attivita: segnale dell'app o, in mancanza, ultimo rinnovo del token (circa ogni ora)
create or replace view monitor.utenti as
select
  u.id::text                                                   as chiave,
  u.email                                                      as nome,
  'staff'                                                      as ruolo,
  u.last_sign_in_at                                            as ultimo_login,
  greatest(p.ultimo_segnale,
           (select max(coalesce(s.refreshed_at at time zone 'UTC', s.updated_at))
              from auth.sessions s where s.user_id = u.id))    as ultima_attivita
from auth.users u
left join monitor.presenze p on p.user_id = u.id;

revoke all on monitor.utenti from public, anon, authenticated;
grant select on monitor.utenti to monitor_ro;
