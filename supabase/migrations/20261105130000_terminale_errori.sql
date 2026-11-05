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
  -- solo colonne base di audit_log (in produzione azione/origine non esistono)
  insert into audit_log(utente, tabella, operazione, record_id, dopo)
  values (
    'Terminale ' || coalesce(nome, '?'),
    'errori',
    'ERRORE',
    v::text,
    jsonb_build_object(
      'motivo', left(coalesce(p_messaggio, ''), 500),
      'codice', left(coalesce(nullif(p_codice, ''), 'altro'), 30),
      'shelly', p_dettaglio->>'shelly',
      'ms', p_dettaglio->'ms',
      'terminale', nome,
      'ora_terminale', p_ts_terminale)
  );
end $$;
revoke execute on function terminale_errore(text, text, text, text, jsonb, timestamptz) from public;
grant execute on function terminale_errore(text, text, text, text, jsonb, timestamptz) to anon, authenticated;
