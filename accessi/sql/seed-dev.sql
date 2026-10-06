-- GymIN Accessi · DATI DEMO per il database di SVILUPPO / TEST. MAI in produzione.
-- Non è una migrazione: non viene applicato automaticamente. Si esegue con `npm run seed:dev`,
-- che imposta gymin.consenti_seed_demo = 'si' (senza, lo script si rifiuta di partire).
-- Idempotente: cancella e ricrea solo i dati marcati DEMO-ACCESSI.
-- Codici tessera = quelli dei pulsanti della simulazione (app/js/demo.js).
do $$
declare
  p_mese uuid; p_tri uuid; p_ann uuid; p_c10 uuid; p_c5 uuid;
  s uuid;
begin
  if coalesce(current_setting('gymin.consenti_seed_demo', true), '') <> 'si' then
    raise exception 'Seed demo bloccato: usa "npm run seed:dev" su un database di sviluppo.';
  end if;

  delete from accessi_log where codice like 'SIM%';
  delete from soci where note = 'DEMO-ACCESSI';
  delete from terminali where nome = 'Terminale DEMO (sviluppo)';
  delete from piani where descrizione = 'DEMO-ACCESSI' and not exists (select 1 from abbonamenti a where a.piano_id = piani.id);

  select id into p_mese from piani where nome = 'Demo · Open Mese';
  if p_mese is null then
    insert into piani(nome,prezzo,durata_mesi,entrate,descrizione) values ('Demo · Open Mese',50,1,0,'DEMO-ACCESSI') returning id into p_mese;
    insert into piani(nome,prezzo,durata_mesi,entrate,descrizione) values ('Demo · Trimestrale',135,3,0,'DEMO-ACCESSI') returning id into p_tri;
    insert into piani(nome,prezzo,durata_mesi,entrate,descrizione) values ('Demo · Annuale',450,12,0,'DEMO-ACCESSI') returning id into p_ann;
    insert into piani(nome,prezzo,durata_mesi,entrate,descrizione) values ('Demo · Carnet 10 ingressi',80,6,10,'DEMO-ACCESSI') returning id into p_c10;
    insert into piani(nome,prezzo,durata_mesi,entrate,descrizione) values ('Demo · Carnet 5 ingressi',45,3,5,'DEMO-ACCESSI') returning id into p_c5;
  else
    select id into p_tri from piani where nome = 'Demo · Trimestrale';
    select id into p_ann from piani where nome = 'Demo · Annuale';
    select id into p_c10 from piani where nome = 'Demo · Carnet 10 ingressi';
    select id into p_c5 from piani where nome = 'Demo · Carnet 5 ingressi';
  end if;

  -- 1 Giulia: Open Mese valido (verde)
  insert into soci(nome,cognome,note) values ('Giulia','Bianchi','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza) values (s,p_mese,current_date-10,current_date+20);
  insert into tessere(socio_id,codice) values (s,'SIM0000001');
  -- 2 Marco: carnet con 3 ingressi (verde, poi avviso giallo)
  insert into soci(nome,cognome,note) values ('Marco','Rossi','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza,entrate_residue) values (s,p_c10,current_date-30,current_date+60,3);
  insert into tessere(socio_id,codice) values (s,'SIM0000002');
  -- 3 Luca: scaduto (rosso)
  insert into soci(nome,cognome,note) values ('Luca','Ferrari','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza) values (s,p_tri,current_date-100,current_date-9);
  insert into tessere(socio_id,codice) values (s,'SIM0000003');
  -- 4 Sara: carnet esaurito
  insert into soci(nome,cognome,note) values ('Sara','Esposito','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza,entrate_residue) values (s,p_c5,current_date-20,current_date+40,0);
  insert into tessere(socio_id,codice) values (s,'SIM0000004');
  -- 5 Andrea: nessun abbonamento
  insert into soci(nome,cognome,note) values ('Andrea','Colombo','DEMO-ACCESSI') returning id into s;
  insert into tessere(socio_id,codice) values (s,'SIM0000005');
  -- 6 Chiara: scadenza + carnet (priorità alla scadenza, il carnet non si tocca)
  insert into soci(nome,cognome,note) values ('Chiara','Ricci','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza) values (s,p_mese,current_date-5,current_date+25);
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza,entrate_residue) values (s,p_c10,current_date-5,current_date+90,7);
  insert into tessere(socio_id,codice) values (s,'SIM0000006');
  -- 7 Matteo: scade tra 3 giorni (verde + avviso)
  insert into soci(nome,cognome,note) values ('Matteo','Greco','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza) values (s,p_mese,current_date-27,current_date+3);
  insert into tessere(socio_id,codice) values (s,'SIM0000007');
  -- 8 Elena: annuale valido ma tessera disattivata (smarrita)
  insert into soci(nome,cognome,note) values ('Elena','Bruno','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza) values (s,p_ann,current_date-100,current_date+265);
  insert into tessere(socio_id,codice,attiva,disattivata_il,motivo_disattivazione) values (s,'SIM0000008',false,now(),'Smarrita');
  -- 9 Davide: abbonamento che inizia tra 4 giorni
  insert into soci(nome,cognome,note) values ('Davide','Gallo','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza) values (s,p_mese,current_date+4,current_date+34);
  insert into tessere(socio_id,codice) values (s,'SIM0000009');
  -- 10 Paolo: abbonamento valido SENZA tessera (per provare l'associazione rapida)
  insert into soci(nome,cognome,note) values ('Paolo','Martini','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza) values (s,p_mese,current_date-1,current_date+29);
  insert into soci(nome,cognome,note) values ('Greta','Leone','DEMO-ACCESSI') returning id into s;
  insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza,entrate_residue) values (s,p_c5,current_date-1,current_date+60,5);

  -- terminale di sviluppo con token NOTO (solo sviluppo!)
  insert into terminali(nome, token_hash)
  values ('Terminale DEMO (sviluppo)', encode(sha256(convert_to('dev-terminale-SOLO-SVILUPPO', 'UTF8')), 'hex'));
end $$;
