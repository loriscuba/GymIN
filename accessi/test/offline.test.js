// Scenario OFFLINE: cache locale, coda eventi, fallback, sincronizzazione, conflitti.
// "Server" = sorgente demo (stesse regole del DB); IndexedDB simulato con fake-indexeddb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { apriArchivio } from '../app/js/archivio.js';
import {
  creaSorgenteDemo, creaSorgenteLocale, creaSorgenteRemota, creaTerminale, ErroreNonSincronizzato,
} from '../app/js/dataLayer.js';
import { creaSincronizzatore } from '../app/js/sync.js';
import { datiDemo } from '../app/js/demo.js';

const ts = () => new Date().toISOString();
const residuoServer = (server, socioId = 's2') => server.dati.abbonamenti.find((a) => a.socio_id === socioId).residuo;

/** fetch finto verso il server demo, con ritardo; il server elabora comunque anche se il client va in timeout */
function fetchVersoDemo(server, { ritardoMs = 0 } = {}) {
  const mappa = {
    terminale_accesso: (a) => server.registraLettura({ codice: a.p_codice, evento_id: a.p_evento_id, ts: a.p_ts_terminale, doppia: a.p_doppia }),
    terminale_snapshot: (a) => server.snapshot(a.p_versione),
    terminale_sync: (a) => server.sync(a.p_eventi),
    terminale_stato: (a) => server.stato(a.p_stato),
    terminale_ping: () => server.ping(),
  };
  return (url, { body, signal }) => new Promise((ok, ko) => {
    const nome = url.split('/rpc/')[1];
    const lavoro = new Promise((r) => setTimeout(r, ritardoMs)).then(() => mappa[nome](JSON.parse(body)));
    signal.addEventListener('abort', () => ko(new Error('abort')));
    lavoro.then((v) => ok({ ok: true, status: 200, text: async () => JSON.stringify(v) }));
  });
}

async function ambiente({ idb = new IDBFactory(), server = creaSorgenteDemo(datiDemo()), ora = () => Date.now(), remoto = server, cacheMaxOre = 72 } = {}) {
  const archivio = await apriArchivio({ idb });
  const locale = creaSorgenteLocale(archivio, { ora, cacheMaxOre });
  const terminale = creaTerminale({ remoto, locale, ora });
  const sync = creaSincronizzatore({ terminale, archivio, ora });
  return { idb, server, archivio, locale, terminale, sync };
}

test('cache vuota + offline: "Terminale non ancora sincronizzato"', async () => {
  const { terminale } = await ambiente();
  terminale.forzaOffline = true;
  await assert.rejects(terminale.registraLettura({ codice: 'SIM0000001', evento_id: randomUUID(), ts: ts() }), ErroreNonSincronizzato);
});

test('prima sincronizzazione: cache minima (niente dati sensibili)', async () => {
  const { sync, archivio, locale } = await ambiente();
  assert.equal(await sync.sincronizza(), true);
  const c = await locale.infoCache();
  assert.ok(c && !c.vecchia);
  assert.equal(c.tessere, 8, 'solo tessere attive');
  const r = await archivio.leggiEDecidi('SIM0000001', (d) => ({ risultato: d }));
  assert.deepEqual(Object.keys(r.socio).sort(), ['cognome', 'id', 'nome']);
});

test('lettura offline: stessa funzione di business, scala il residuo locale, evento in coda', async () => {
  const { server, sync, terminale, archivio } = await ambiente();
  await sync.sincronizza();
  terminale.forzaOffline = true;
  const r1 = await terminale.registraLettura({ codice: 'SIM0000002', evento_id: randomUUID(), ts: ts() });
  assert.deepEqual([r1.esito, r1.offline, r1.residuo_dopo], ['ok', true, 2]);
  const r2 = await terminale.registraLettura({ codice: 'sim0000002', evento_id: randomUUID(), ts: ts() });
  assert.equal(r2.residuo_dopo, 1);
  const neg = await terminale.registraLettura({ codice: 'SIM0000003', evento_id: randomUUID(), ts: ts() });
  assert.equal(neg.esito, 'negato');
  assert.match(neg.motivo, /scaduto/);
  assert.equal(residuoServer(server), 3, 'il server non è stato toccato');
  const coda = await archivio.coda();
  assert.equal(coda.length, 3);
  assert.deepEqual(Object.keys(coda[0]).sort(), ['codice', 'doppia', 'esito', 'evento_id', 'nota', 'tentativi', 'ts']);
  assert.equal(coda[0].esito.residuo_prima, 3);
  assert.equal(coda[0].esito.residuo_dopo, 2);
});

test('ritorno online: sincronizza in ordine, svuota la coda, il server scala e marca "offline"', async () => {
  const { server, sync, terminale, archivio, locale } = await ambiente();
  await sync.sincronizza();
  terminale.forzaOffline = true;
  for (let i = 0; i < 2; i++) await terminale.registraLettura({ codice: 'SIM0000002', evento_id: randomUUID(), ts: ts() });
  terminale.forzaOffline = false;
  assert.equal(await sync.sincronizza(), true);
  assert.equal(await archivio.contaCoda(), 0);
  assert.equal(residuoServer(server), 1);
  assert.ok(server.log.every((l) => l.offline));
  const a = await archivio.leggiEDecidi('SIM0000002', (d) => ({ risultato: d.abbonamenti[0] }));
  assert.equal(a.residuo, 1, 'cache ricaricata dal server');
  assert.equal((await locale.infoCache()).vecchia, false);
});

test('sincronizzazione idempotente: lo stesso evento inviato due volte non scala due volte', async () => {
  const { server, sync, terminale, archivio } = await ambiente();
  await sync.sincronizza();
  terminale.forzaOffline = true;
  await terminale.registraLettura({ codice: 'SIM0000002', evento_id: randomUUID(), ts: ts() });
  const eventi = await archivio.coda();
  const r1 = await server.sync(eventi);
  const r2 = await server.sync(eventi);   // es. risposta persa e reinvio
  assert.equal(r1.risultati[0].duplicato, false);
  assert.equal(r2.risultati[0].duplicato, true);
  assert.equal(residuoServer(server), 2);
  assert.equal(server.log.length, 1);
});

test('timeout online (~2 s): fallback locale con lo STESSO evento_id, nessuna doppia scalatura', async () => {
  const server = creaSorgenteDemo(datiDemo());
  const veloce = creaSorgenteRemota({ url: 'https://x', anonKey: 'k', token: 't', timeoutMs: 2000, fetchFn: fetchVersoDemo(server) });
  const lento = creaSorgenteRemota({ url: 'https://x', anonKey: 'k', token: 't', timeoutMs: 40, fetchFn: fetchVersoDemo(server, { ritardoMs: 120 }) });
  const env = await ambiente({ server, remoto: veloce });
  await env.sync.sincronizza();
  // il terminale usa la sorgente lenta: va in timeout, ma il server elabora comunque la richiesta
  const term = creaTerminale({ remoto: lento, locale: env.locale });
  const evento_id = randomUUID();
  const r = await term.registraLettura({ codice: 'SIM0000002', evento_id, ts: ts() });
  assert.equal(r.offline, true, 'risposta dal fallback locale');
  assert.equal(r.evento_id, evento_id);
  assert.equal(term.online, false);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(residuoServer(server), 2, 'il server aveva in realtà elaborato');
  assert.deepEqual((await env.archivio.coda()).map((e) => e.evento_id), [evento_id], 'stesso evento in coda');
  assert.equal(await env.sync.sincronizza(), true);
  assert.equal(residuoServer(server), 2, 'nessuna seconda scalatura');
  assert.equal(server.log.filter((l) => l.evento_id === evento_id).length, 1);
  assert.equal(await env.archivio.contaCoda(), 0);
});

test('conflitto: ingressi esauriti sul server durante l\'offline -> "da verificare", mai sotto zero, nessun evento perso', async () => {
  const { server, sync, terminale, archivio } = await ambiente();
  await sync.sincronizza();
  terminale.forzaOffline = true;
  const r = await terminale.registraLettura({ codice: 'SIM0000002', evento_id: randomUUID(), ts: ts() });
  assert.equal(r.esito, 'ok');                                     // alla porta: verde (dati locali)
  server.dati.abbonamenti.find((a) => a.socio_id === 's2').residuo = 0;   // nel frattempo consumati altrove
  terminale.forzaOffline = false;
  await sync.sincronizza();
  const l = server.log.at(-1);
  assert.deepEqual([l.esito, l.da_verificare, l.motivo], ['ok', true, 'Ingressi esauriti']);
  assert.equal(residuoServer(server), 0);
  assert.equal(await archivio.contaCoda(), 0);
});

test('conflitto: abbonamento scaduto sul server -> da verificare; respinto offline resta respinto', async () => {
  const { server, sync, terminale } = await ambiente();
  await sync.sincronizza();
  terminale.forzaOffline = true;
  await terminale.registraLettura({ codice: 'SIM0000001', evento_id: randomUUID(), ts: ts() });
  await terminale.registraLettura({ codice: 'SIM0000004', evento_id: randomUUID(), ts: new Date(Date.now() + 5).toISOString() });
  server.dati.abbonamenti.find((a) => a.socio_id === 's1').data_scadenza = '2020-01-01';
  server.dati.abbonamenti.find((a) => a.socio_id === 's4').residuo = 5;   // ricaricato nel frattempo
  terminale.forzaOffline = false;
  await sync.sincronizza();
  const [l1, l4] = server.log;
  assert.deepEqual([l1.esito, l1.da_verificare], ['ok', true]);
  assert.deepEqual([l4.esito, l4.motivo], ['negato', 'Ingressi esauriti'], 'vale la decisione presa alla porta');
  assert.equal(residuoServer(server, 's4'), 5, 'nessuna scalatura per un ingresso negato');
});

test('cache troppo vecchia: continua a funzionare, avvisa e lo segnala nel log', async () => {
  let adesso = Date.now();
  const env = await ambiente({ ora: () => adesso, cacheMaxOre: 72 });
  await env.sync.sincronizza();
  adesso += 80 * 3600 * 1000;
  env.terminale.forzaOffline = true;
  const c = await env.locale.infoCache();
  assert.equal(c.vecchia, true);
  assert.equal(Math.floor(c.ore), 80);
  const r = await env.terminale.registraLettura({ codice: 'SIM0000001', evento_id: randomUUID(), ts: ts() });
  assert.equal(r.esito, 'ok');
  assert.equal(r.cache_vecchia, true);
  assert.equal((await env.archivio.coda())[0].nota, 'Dati locali non aggiornati da 80 ore');
});

test('riavvio con coda piena: la coda sopravvive e viene sincronizzata', async () => {
  const idb = new IDBFactory();
  const server = creaSorgenteDemo(datiDemo());
  const a = await ambiente({ idb, server });
  await a.sync.sincronizza();
  a.terminale.forzaOffline = true;
  for (let i = 0; i < 60; i++) {
    await a.terminale.registraLettura({ codice: i % 2 ? 'SIM0000001' : 'SIM0000006', evento_id: randomUUID(), ts: new Date(Date.now() + i).toISOString() });
  }
  a.archivio.chiudi();                               // "spegnimento"
  const b = await ambiente({ idb, server });         // riavvio: stesso database IndexedDB
  assert.equal(await b.archivio.contaCoda(), 60);
  assert.ok(await b.locale.infoCache(), 'anche la cache sopravvive');
  assert.equal(await b.sync.sincronizza(), true);    // 2 lotti da 50 + 10
  assert.equal(await b.archivio.contaCoda(), 0);
  assert.equal(server.log.length, 60);
  const ordine = server.log.map((l) => l.ts_terminale);
  assert.deepEqual(ordine, [...ordine].sort(), 'inviati in ordine cronologico');
});

test('orologio sfasato: rilevato e comunicato al server', async () => {
  const env = await ambiente({ ora: () => Date.now() + 10 * 60 * 1000 });
  await env.sync.sincronizza();
  assert.ok(Math.abs(env.sync.stato.sfasamentoMs - 600000) < 5000);
  assert.equal(env.sync.orologioSfasato(), true);
  assert.equal(env.server.ultimoStato.orologio_sfasato, true);
  const ok = await ambiente();
  await ok.sync.sincronizza();
  assert.equal(ok.sync.orologioSfasato(), false);
});

test('retry con backoff esponenziale finché il server non risponde', async () => {
  const env = await ambiente();
  env.terminale.forzaOffline = true;
  for (const atteso of [5000, 10000, 20000, 40000]) {
    assert.equal(await env.sync.sincronizza(), false);
    assert.equal(env.sync.prossimoRitardo(), atteso);
  }
  env.terminale.forzaOffline = false;
  assert.equal(await env.sync.sincronizza(), true);
  assert.equal(env.sync.prossimoRitardo(), 60000);
});

test('dopo un errore di rete le letture vanno subito in locale; tornano online dopo una sync riuscita', async () => {
  const env = await ambiente();
  await env.sync.sincronizza();
  env.terminale.segnaOffline();
  const r = await env.terminale.registraLettura({ codice: 'SIM0000001', evento_id: randomUUID(), ts: ts() });
  assert.equal(r.offline, true);
  await env.sync.sincronizza();
  const r2 = await env.terminale.registraLettura({ codice: 'SIM0000001', evento_id: randomUUID(), ts: ts() });
  assert.equal(r2.offline, false);
});

test('online: il residuo locale resta allineato al server', async () => {
  const env = await ambiente();
  await env.sync.sincronizza();
  await env.terminale.registraLettura({ codice: 'SIM0000002', evento_id: randomUUID(), ts: ts() });
  await new Promise((r) => setTimeout(r, 20));
  const a = await env.archivio.leggiEDecidi('SIM0000002', (d) => ({ risultato: d.abbonamenti[0] }));
  assert.equal(a.residuo, 2);
});

test('doppia lettura offline: in coda senza scalare', async () => {
  const env = await ambiente();
  await env.sync.sincronizza();
  env.terminale.forzaOffline = true;
  const r = await env.terminale.registraLettura({ codice: 'SIM0000002', evento_id: randomUUID(), ts: ts(), doppia: true });
  assert.equal(r.esito, 'doppia_lettura');
  const a = await env.archivio.leggiEDecidi('SIM0000002', (d) => ({ risultato: d.abbonamenti[0] }));
  assert.equal(a.residuo, 3);
  env.terminale.forzaOffline = false;
  await env.sync.sincronizza();
  assert.equal(env.server.log[0].esito, 'doppia_lettura');
  assert.equal(residuoServer(env.server), 3);
});

test('snapshot arrivato con eventi ancora in coda: gli ingressi non sincronizzati restano scalati', async () => {
  const env = await ambiente();
  await env.sync.sincronizza();
  env.terminale.forzaOffline = true;
  await env.terminale.registraLettura({ codice: 'SIM0000002', evento_id: randomUUID(), ts: ts() });
  await env.archivio.applicaSnapshot(await env.server.snapshot());   // server ancora a 3
  const a = await env.archivio.leggiEDecidi('SIM0000002', (d) => ({ risultato: d.abbonamenti[0] }));
  assert.equal(a.residuo, 2);
});

test('eventi rifiutati dal server restano in coda (mai persi) e non bloccano gli altri', async () => {
  const env = await ambiente();
  await env.sync.sincronizza();
  env.terminale.forzaOffline = true;
  for (let i = 0; i < 3; i++) await env.terminale.registraLettura({ codice: 'SIM0000001', evento_id: randomUUID(), ts: new Date(Date.now() + i).toISOString() });
  const [primo] = await env.archivio.coda();
  const syncOriginale = env.server.sync.bind(env.server);
  env.server.sync = async (eventi) => {
    const buoni = await syncOriginale(eventi.filter((e) => e.evento_id !== primo.evento_id));
    if (eventi.some((e) => e.evento_id === primo.evento_id)) buoni.risultati.unshift({ evento_id: primo.evento_id, ok: false, errore: 'rifiutato' });
    return buoni;
  };
  env.terminale.forzaOffline = false;
  await env.sync.sincronizza();
  const coda = await env.archivio.coda();
  assert.deepEqual(coda.map((e) => e.evento_id), [primo.evento_id], 'solo il rifiutato resta in coda');
  assert.equal(coda[0].tentativi, 1);
  assert.equal(env.sync.stato.eventiConErrori, 1);
  assert.equal(env.server.log.length, 2);
});
