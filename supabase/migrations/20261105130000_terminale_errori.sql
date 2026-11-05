-- Log attività → sezione "Errori": il terminale d'ingresso segnala perché il tornello/porta NON si è
-- aperto (Shelly non risponde, indirizzo IP sbagliato, errore HTTP, ...). Ogni errore diventa una riga
-- di audit_log (tabella 'errori', operazione 'ERRORE'), visibile solo agli admin come il resto del log.
-- Solo aggiunte. Si può rieseguire senza problemi.

create or replace function terminale_errore(p_token text, p_tipo text, p_codice text, p_messaggio text,
                                            p_dettaglio jsonb default null, p_ts_terminale timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v    uuid := terminale_autentica(p_token);
  nome text := (select t.nome from terminali t where t.id = v);
begin
  insert into audit_log(utente, tabella, operazione, record_id, dopo, azione, origine)
  values (
    'Terminale ' || coalesce(nome, '?'),
    'errori',
    'ERRORE',
    v::text,
    coalesce(p_dettaglio, '{}'::jsonb) || jsonb_build_object(
      'terminale', nome,
      'tipo', left(coalesce(nullif(p_tipo, ''), 'porta'), 30),
      'problema', left(coalesce(nullif(p_codice, ''), 'altro'), 30),
      'ora_terminale', p_ts_terminale),
    left(coalesce(p_messaggio, ''), 500),
    'Terminale d''ingresso'
  );
end $$;
revoke execute on function terminale_errore(text, text, text, text, jsonb, timestamptz) from public;
grant execute on function terminale_errore(text, text, text, text, jsonb, timestamptz) to anon, authenticated;
