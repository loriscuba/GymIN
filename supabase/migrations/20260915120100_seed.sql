-- GymIN · dati demo realistici (palestra boutique ~180 soci)
-- Idempotente-ish: esegue il seed solo se non ci sono ancora soci.

do $$
declare
  nomi    text[] := array['Marco','Giulia','Luca','Sara','Andrea','Chiara','Matteo','Francesca','Davide','Elena',
                          'Simone','Martina','Alessandro','Valentina','Federico','Alice','Lorenzo','Giorgia','Riccardo','Aurora',
                          'Gabriele','Sofia','Tommaso','Beatrice','Stefano','Noemi','Nicola','Ilaria','Paolo','Greta'];
  cognomi text[] := array['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco',
                          'Bruno','Gallo','Conti','De Luca','Mancini','Costa','Giordano','Rizzo','Lombardi','Moretti',
                          'Barbieri','Fontana','Santoro','Mariani','Rinaldi','Caruso','Ferrara','Galli','Martini','Leone'];
  piani_ids  uuid[];
  piani_dur  int[];
  piani_prz  numeric[];
  piani_ent  int[];
  v_entrate  int;
  v_residue  int;
  idx        int;
  v_socio    uuid;
  v_abb      uuid;
  v_nome     text;
  v_cog      text;
  v_email    text;
  v_start    date;
  v_end      date;
  v_dur      int;
  v_prezzo   numeric;
  i          int;
begin
  if exists (select 1 from soci limit 1) then
    raise notice 'Seed saltato: la tabella soci contiene già dati.';
    return;
  end if;

  insert into piani(nome, prezzo, durata_mesi, entrate, descrizione) values
    ('Open Mese',       59,  1,  0, 'Accesso libero sala e corsi'),
    ('Trimestrale',     159, 3,  0, '3 mesi, sala + corsi'),
    ('Annuale',         499, 12, 0, '12 mesi, miglior prezzo'),
    ('Student',         39,  1,  0, 'Under 26, orario ridotto'),
    ('Personal 10',     350, 4,  0, '10 sedute personal trainer'),
    ('Carnet 5 entrate', 45, 6,  5, 'Pacchetto 5 ingressi a consumo');

  select array_agg(id order by creato_il),
         array_agg(durata_mesi order by creato_il),
         array_agg(prezzo order by creato_il),
         array_agg(entrate order by creato_il)
    into piani_ids, piani_dur, piani_prz, piani_ent
    from piani;

  for i in 1..90 loop
    v_nome  := nomi[1 + floor(random() * array_length(nomi, 1))::int];
    v_cog   := cognomi[1 + floor(random() * array_length(cognomi, 1))::int];
    v_email := lower(v_nome || '.' || replace(v_cog, ' ', '') || i || '@email.it');

    idx      := 1 + floor(random() * array_length(piani_ids, 1))::int;
    v_dur    := piani_dur[idx];
    v_prezzo := piani_prz[idx];
    v_entrate := piani_ent[idx];
    v_residue := case when v_entrate > 0 then floor(random() * (v_entrate + 1))::int else null end;  -- carnet: 0..5

    v_start := current_date - floor(random() * 400)::int;
    v_end   := (v_start + (v_dur || ' months')::interval)::date;
    -- simula i rinnovi: porta avanti la scadenza finché plausibile (~72% rinnova)
    while v_end < current_date and random() < 0.72 loop
      v_start := v_end;
      v_end   := (v_end + (v_dur || ' months')::interval)::date;
    end loop;

    insert into soci(nome, cognome, email, telefono, data_nascita, tessera, consenso_mail)
    values (
      v_nome, v_cog, v_email,
      '+39 3' || (10 + floor(random() * 89))::text || ' ' || (1000000 + floor(random() * 8999999))::text,
      current_date - (6570 + floor(random() * 14600))::int,   -- età 18-58
      'GY-' || (1200 + i)::text,
      random() < 0.85                                          -- 85% ha dato consenso mail
    )
    returning id into v_socio;

    insert into abbonamenti(socio_id, piano_id, data_inizio, data_scadenza, entrate_residue, stato)
    values (
      v_socio, piani_ids[idx], v_start, v_end, v_residue,
      case when v_entrate > 0 then case when v_residue <= 0 then 'scaduto' when v_residue <= 1 then 'in_scadenza' else 'attivo' end
           when v_end < current_date then 'scaduto'
           when v_end <= current_date + 30 then 'in_scadenza'
           else 'attivo' end
    )
    returning id into v_abb;

    insert into pagamenti(abbonamento_id, importo, metodo, data)
    values (v_abb, v_prezzo,
            (array['contanti','carta','bonifico'])[1 + floor(random() * 3)::int],
            v_start);
  end loop;

  -- porta ~18 abbonamenti nella finestra "in scadenza" (1-30 giorni)
  update abbonamenti set data_scadenza = current_date + (3 + floor(random() * 27))::int, stato = 'in_scadenza'
  where id in (
    select id from abbonamenti where data_scadenza > current_date + 30 and entrate_residue is null order by random() limit 18
  );

  -- accessi di oggi (~14) tra i soci con abbonamento non scaduto
  insert into accessi(socio_id, ingresso, esito, registrato_il)
  select s.id,
         (array['Tornello A','Tornello B','Reception'])[1 + floor(random() * 3)::int],
         'valido',
         current_date + interval '7 hours' + (floor(random() * 720)::int || ' minutes')::interval
  from soci s
  join abbonamenti a on a.socio_id = s.id
  where a.data_scadenza >= current_date
  order by random()
  limit 14;

  raise notice 'Seed completato: 5 piani, 90 soci, abbonamenti, pagamenti e accessi.';
end $$;
