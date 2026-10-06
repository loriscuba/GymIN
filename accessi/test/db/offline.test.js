// Fase 2 su Postgres vero: snapshot, sync idempotente, conflitti, stato; e il terminale COMPLETO
// (sorgente remota + IndexedDB + sincronizzatore) collegato al DB come ruolo anon.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { preparaDb, come } from './helper.mjs';
import { apriArchivio } from '../../app/js/archivio.js';
import { creaSorgenteRemota, creaSorgenteLocale, creaTerminale } from '../../app/js/dataLayer.js';
import { creaSincronizzatore } from '../../app/js/sync.js';

let pool, token, termId;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const staff = (fn) => come(pool, 'authenticated', fn);
const anon = (fn) => come(pool, 'anon', fn);
const rpcAnon = (sql, p) => anon((c) => c.query(sql, p).then((r) => r.rows[0].r));

async function socio(nome, abbonamenti = [], codice = null) {
  const [{ id }] = await q(`insert into soci(nome,cognome,email,telefono,note) values ($1,'Off',lower($1)||'@y.it','333','riservato') returning id`, [nome]);
  for (const a of abbonamenti) {
    await q(`insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza,entrate_residue,stato)
             values ($1,(select id from piani where nome=$2),current_date + $3::int, current_date + $4::int, $5, coalesce($6,'attivo'))`,
    [id, a.piano, a.da, a.a, a.residuo ?? null, a.stato ?? null]);
  }
  if (codice) await staff((c) => c.query('select staff_assegna_tessera($1,$2)', [id, codice]));
  return id;
}
const residuo = async (id) => (await q('select entrate_residue r from abbonamenti where socio_id=$1 and entrate_residue is not null', [id]))[0].r;
const evento = (codice, esito, extra = {}) => ({ evento_id: randomUUID(), codice, ts: new Date().toISOString(), doppia: false, esito, nota: '', ...extra });

/** fetch verso PostgREST simulato: chiama la funzione RPC sul DB come ruolo anon */
function fetchVersoDb() {
  return async (url, { body }) => {
    const nome = url.split('/rpc/')[1];
    const args = JSON.parse(body);
    const nomi = Object.keys(args);
    const sql = `select ${nome}(${nomi.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`;
    const valori = nomi.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    try {
      const r = await rpcAnon(sql, valori);
      return { ok: true, status: 200, text: async () => JSON.stringify(r) };
    } catch (e) {
      return { ok: false, status: e.code === '28000' ? 403 : 400, text: async () => JSON.stringify({ code: e.code, message: e.message }) };
    }
  };
}

before(async () => {
  pool = await preparaDb();
  await q(`insert into piani(nome,prezzo,durata_mesi,entrate) values ('Open Mese',50,1,0),('Carnet 10',80,6,10)`);
  const t = await staff((c) => c.query(`select staff_crea_terminale('Ingresso offline') r`).then((r) => r.rows[0].r));
  token = t.token;
  termId = t.id;
});
after(() => pool?.end());

test('snapshot: solo tessere attive e dati minimi; abbonamenti recenti; versione invariata', async () => {
  const a = await socio('Snap', [
    { piano: 'Open Mese', da: -10, a: 20 },
    { piano: 'Open Mese', da: -200, a: -100 },                       // troppo vecchio
    { piano: 'Open Mese', da: -10, a: 20, stato: 'archiviato' },     // archiviato
    { piano: 'Carnet 10', da: -10, a: 50, residuo: 4 },
  ], 'SNAP-1');
  const s = await rpcAnon('select terminale_snapshot($1) r', [token]);
  const so = s.soci.find((x) => x.id === a);
  assert.deepEqual(Object.keys(so).sort(), ['cognome', 'id', 'nome'], 'niente email/telefono/note');
  assert.ok(s.tessere.some((t) => t.codice === 'SNAP-1'));
  const abbs = s.abbonamenti.filter((x) => x.socio_id === a);
  assert.equal(abbs.length, 2);
  assert.ok(abbs.every((x) => !('prezzo' in x)));
  assert.equal(abbs.find((x) => x.tipo === 'ingressi').residuo, 4);
  const s2 = await rpcAnon('select terminale_snapshot($1,$2) r', [token, s.versione]);
  assert.equal(s2.invariato, true);
  assert.equal(s2.tessere, undefined);
  const [t] = await q(`select id from tessere where codice='SNAP-1'`);
  await staff((c) => c.query('select staff_disattiva_tessera($1)', [t.id]));
  const s3 = await rpcAnon('select terminale_snapshot($1,$2) r', [token, s.versione]);
  assert.equal(s3.invariato, false);
  assert.ok(!s3.tessere.some((x) => x.codice === 'SNAP-1'), 'tessera disattivata esclusa');
});

test('sync: registra con timestamp del terminale e marcatura offline; idempotente', async () => {
  const id = await socio('Sync', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 5 }], 'SYNC-1');
  const quando = new Date(Date.now() - 3600_000).toISOString();
  const e = evento('SYNC-1', { esito: 'ok', tipo: 'ingressi' }, { ts: quando, nota: 'Dati locali non aggiornati da 80 ore' });
  const r1 = await rpcAnon('select terminale_sync($1,$2) r', [token, JSON.stringify([e])]);
  assert.deepEqual([r1.risultati[0].ok, r1.risultati[0].duplicato], [true, false]);
  const r2 = await rpcAnon('select terminale_sync($1,$2) r', [token, JSON.stringify([e])]);
  assert.equal(r2.risultati[0].duplicato, true);
  assert.equal(await residuo(id), 4, 'scalato una sola volta');
  const [l] = await q('select * from accessi_log where evento_id=$1', [e.evento_id]);
  assert.equal(l.offline, true);
  assert.equal(new Date(l.ts_terminale).toISOString(), quando);
  assert.ok(l.ts_server > l.ts_terminale, 'registrato anche il timestamp di ricezione');
  assert.equal(l.nota, 'Dati locali non aggiornati da 80 ore');
  const [acc] = await q('select registrato_il from accessi where id=$1', [l.accesso_id]);
  assert.equal(new Date(acc.registrato_il).toISOString(), quando);
  const [t] = await q('select ultima_sync from terminali where id=$1', [termId]);
  assert.ok(t.ultima_sync);
});

test('sync: online già elaborato + stesso evento da offline -> duplicato, nessuna doppia scalatura', async () => {
  const id = await socio('Timeout', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 5 }], 'TIMEOUT-1');
  const e = evento('TIMEOUT-1', { esito: 'ok', tipo: 'ingressi' });
  await rpcAnon('select terminale_accesso($1,$2,$3,$4) r', [token, e.codice, e.evento_id, e.ts]);   // il server aveva risposto troppo tardi
  const r = await rpcAnon('select terminale_sync($1,$2) r', [token, JSON.stringify([e])]);
  assert.equal(r.risultati[0].duplicato, true);
  assert.equal(await residuo(id), 4);
});

test('sync: conflitto (esaurito sul server) -> da verificare, residuo mai sotto zero, in /gestione', async () => {
  const id = await socio('Conflitto', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 1 }], 'CONF-1');
  const e1 = evento('CONF-1', { esito: 'ok', tipo: 'ingressi' });
  const e2 = evento('CONF-1', { esito: 'ok', tipo: 'ingressi' }, { ts: new Date(Date.now() + 1000).toISOString() });
  const r = await rpcAnon('select terminale_sync($1,$2) r', [token, JSON.stringify([e2, e1])]);   // inviati in disordine
  assert.deepEqual(r.risultati.map((x) => x.evento_id), [e1.evento_id, e2.evento_id], 'applicati in ordine cronologico');
  assert.deepEqual(r.risultati.map((x) => x.da_verificare), [false, true]);
  assert.equal(await residuo(id), 0);
  const lista = await staff((c) => c.query(`select * from accessi_log where da_verificare and verificato_il is null and socio_id=$1`, [id]).then((x) => x.rows));
  assert.equal(lista.length, 1);
  assert.equal(lista[0].motivo, 'Ingressi esauriti');
  assert.equal(lista[0].esito, 'ok');
  assert.equal(lista[0].residuo_dopo, null, 'nessuna scalatura sul conflitto');
});

test('sync: tessera disattivata nel frattempo -> registrato sul socio indicato dal terminale, da verificare', async () => {
  const id = await socio('Dis', [{ piano: 'Open Mese', da: -5, a: 20 }], 'DIS-OFF');
  const [t] = await q(`select id from tessere where codice='DIS-OFF'`);
  await staff((c) => c.query('select staff_disattiva_tessera($1)', [t.id]));
  const e = evento('DIS-OFF', { esito: 'ok', tipo: 'scadenza', socio_id: id });
  const r = await rpcAnon('select terminale_sync($1,$2) r', [token, JSON.stringify([e])]);
  assert.equal(r.risultati[0].da_verificare, true);
  const [l] = await q('select socio_id, motivo from accessi_log where evento_id=$1', [e.evento_id]);
  assert.deepEqual([l.socio_id, l.motivo], [id, 'Tessera sconosciuta']);
});

test('sync: un evento non valido non blocca gli altri; lotti oltre 200 rifiutati', async () => {
  await socio('Lotto', [{ piano: 'Open Mese', da: -5, a: 20 }], 'LOTTO-1');
  const buono = evento('LOTTO-1', { esito: 'ok', tipo: 'scadenza' });
  const cattivo = evento('', { esito: 'ok' });
  const r = await rpcAnon('select terminale_sync($1,$2) r', [token, JSON.stringify([buono, cattivo])]);
  assert.deepEqual(r.risultati.map((x) => x.ok).sort(), [false, true]);
  await assert.rejects(rpcAnon('select terminale_sync($1,$2) r', [token, JSON.stringify(Array.from({ length: 201 }, () => buono))]), /200/);
});

test('stato del terminale e "Sincronizza ora" dallo staff', async () => {
  const r0 = await rpcAnon('select terminale_stato($1,$2) r', [token, JSON.stringify({ in_coda: 3, orologio_sfasato: false })]);
  assert.equal(r0.sync_richiesta, false);
  await staff((c) => c.query('select staff_richiedi_sync($1)', [termId]));
  const r1 = await rpcAnon('select terminale_stato($1,$2) r', [token, JSON.stringify({ in_coda: 3 })]);
  assert.equal(r1.sync_richiesta, true);
  const r2 = await rpcAnon('select terminale_stato($1,$2) r', [token, JSON.stringify({ in_coda: 0 })]);
  assert.equal(r2.sync_richiesta, false, 'la richiesta vale una volta');
  const [t] = await staff((c) => c.query('select stato from terminali where id=$1', [termId]).then((x) => x.rows));
  assert.equal(t.stato.in_coda, 0);
  assert.ok(t.stato.ricevuto_il);
  await assert.rejects(anon((c) => c.query('select staff_richiedi_sync($1)', [termId])), /permission denied/);
  await assert.rejects(rpcAnon('select terminale_snapshot($1) r', ['sbagliato']), /non autorizzato/);
});

test('INTEGRAZIONE: terminale completo offline -> online contro il DB vero', async () => {
  const id = await socio('Integra', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 3 }], 'INTEGRA-1');
  const remoto = creaSorgenteRemota({ url: 'https://db', anonKey: 'anon', token, fetchFn: fetchVersoDb() });
  const archivio = await apriArchivio({ idb: new IDBFactory() });
  const terminale = creaTerminale({ remoto, locale: creaSorgenteLocale(archivio) });
  const sync = creaSincronizzatore({ terminale, archivio });
  assert.equal(await sync.sincronizza(), true, 'prima sincronizzazione');

  const online = await terminale.registraLettura({ codice: 'integra-1', evento_id: randomUUID(), ts: new Date().toISOString() });
  assert.deepEqual([online.offline, online.residuo_dopo], [false, 2]);

  terminale.forzaOffline = true;                       // stacco la rete
  const off1 = await terminale.registraLettura({ codice: 'INTEGRA-1', evento_id: randomUUID(), ts: new Date().toISOString() });
  const off2 = await terminale.registraLettura({ codice: 'INTEGRA-1', evento_id: randomUUID(), ts: new Date(Date.now() + 10).toISOString() });
  const off3 = await terminale.registraLettura({ codice: 'INTEGRA-1', evento_id: randomUUID(), ts: new Date(Date.now() + 20).toISOString() });
  assert.deepEqual([off1.residuo_dopo, off2.residuo_dopo, off3.esito], [1, 0, 'negato']);
  assert.equal(await residuo(id), 2, 'server non toccato durante l\'offline');
  // nel frattempo in reception l'ultimo ingresso viene usato da un altro terminale
  await q('update abbonamenti set entrate_residue = 1 where socio_id=$1', [id]);

  terminale.forzaOffline = false;                      // riattacco la rete
  assert.equal(await sync.sincronizza(), true);
  assert.equal(await archivio.contaCoda(), 0);
  assert.equal(await residuo(id), 0, 'mai sotto zero');
  const log = await q(`select esito, offline, da_verificare, residuo_dopo from accessi_log where socio_id=$1 order by ts_terminale`, [id]);
  assert.deepEqual(log.map((l) => [l.esito, l.offline, l.da_verificare]), [
    ['ok', false, false], ['ok', true, false], ['ok', true, true], ['negato', true, false]]);
  const cache = await archivio.leggiEDecidi('INTEGRA-1', (d) => ({ risultato: d.abbonamenti[0] }));
  assert.equal(cache.residuo, 0, 'cache ricaricata dal server');
});
