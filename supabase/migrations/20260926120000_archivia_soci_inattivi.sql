-- Soci inattivi: se l'ULTIMO abbonamento di un socio è scaduto da più di 2 anni,
-- tutti i suoi abbonamenti vengono marcati stato = 'archiviato'.
-- Il frontend ignora gli abbonamenti archiviati, quindi il socio risulta
-- "Senza abbonamento". Nessun dato viene cancellato (pagamenti inclusi).
-- Un nuovo abbonamento (stato 'attivo') riattiva normalmente il socio.
--
-- Anteprima (da eseguire prima, se si vuole vedere chi verrà toccato):
--   select s.tessera, s.nome, s.cognome, max(a.data_scadenza) as ultima_scadenza
--   from soci s join abbonamenti a on a.socio_id = s.id
--   group by s.id having max(a.data_scadenza) < current_date - interval '2 years'
--   order by ultima_scadenza;

update abbonamenti a
set stato = 'archiviato'
where a.stato <> 'archiviato'
  and a.socio_id in (
    select socio_id from abbonamenti
    group by socio_id
    having max(data_scadenza) < current_date - interval '2 years'
  );
