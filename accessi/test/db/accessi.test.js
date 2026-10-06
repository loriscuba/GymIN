// Test delle funzioni SQL su Postgres vero. Avvio: npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { preparaDb, come } from './helper.mjs';

let pool, token;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const oggiDb = async () => (await q(`select (now() at time zone 'Europe/Rome')::date::text d`))[0].d;

const staff = (fn) => come(pool, 'authenticated', fn);
const anon = (fn) => come(pool, 'anon', fn);
const leggi = (codice, evento = randomUUID(), extra = {}) =>
  anon((c) => c.query('select terminale_accesso($1,$2,$3,$4,$5) r',
    [extra.token ?? token, codice, evento, extra.ts ?? new Date().toISOString(), extra.doppia ?? false]).then((r) => r.rows[0].r));

async function socio(nome, abbonamenti = [], codice = null) {
  const [{ id }] = await q(`insert into soci(nome,cognome) values ($1,'Test') returning id`, [nome]);
  for (const a of abbonamenti) {
    await q(`insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza,entrate_residue,stato)
             values ($1,(select id from piani where nome=$2),current_date + $3::int, current_date + $4::int, $5, coalesce($6,'attivo'))`,
    [id, a.piano, a.da, a.a, a.residuo ?? null, a.stato ?? null]);
  }
  if (codice) await staff((c) => c.query('select staff_assegna_tessera($1,$2)', [id, codice]));
  return id;
}
const residuo = async (socioId) => (await q('select entrate_residue r from abbonamenti where socio_id=$1', [socioId]))[0].r;

before(async () => {
  pool = await preparaDb();
  await q(`insert into piani(nome,prezzo,durata_mesi,entrate) values ('Open Mese',50,1,0),('Carnet 10',80,6,10)`);
  token = await staff((c) => c.query(`select staff_crea_terminale('Ingresso test') r`).then((r) => r.rows[0].r.token));
});
after(() => pool?.end());

test('parità JS/SQL: accessi_decidi rispetta i casi condivisi', async () => {
  const { casi } = JSON.parse(readFileSync(new URL('../casi-esito.json', import.meta.url)));
  for (const c of casi) {
    const [{ r }] = await q('select accessi_decidi($1::jsonb, $2::date) r', [JSON.stringify(c.abbonamenti), c.oggi]);
    for (const [k, v] of Object.entries(c.atteso)) assert.equal(r[k], v, `${c.nome} · ${k}`);
  }
});

test('tessera sconosciuta: rosso, registrata nel log', async () => {
  const r = await leggi('  sconosciuta 1 ');
  assert.equal(r.esito, 'negato');
  assert.equal(r.motivo, 'Tessera sconosciuta');
  const [l] = await q('select * from accessi_log where evento_id=$1', [r.evento_id]);
  assert.equal(l.codice, 'SCONOSCIUTA1');
});

test('tessera disattivata = sconosciuta', async () => {
  const s = await socio('Disattivata', [{ piano: 'Open Mese', da: -1, a: 20 }], 'DIS-1');
  const [{ id }] = await q(`select id from tessere where socio_id=$1`, [s]);
  await staff((c) => c.query('select staff_disattiva_tessera($1, $2)', [id, 'Smarrita']));
  assert.equal((await leggi('DIS-1')).motivo_codice, 'tessera_sconosciuta');
});

test('scadenza valida: verde senza scalare, specchio in accessi', async () => {
  const s = await socio('Scadenza', [{ piano: 'Open Mese', da: -10, a: 3 }], 'SCAD-OK');
  const r = await leggi('scad-ok');
  assert.equal(r.esito, 'ok');
  assert.equal(r.tipo, 'scadenza');
  assert.equal(r.giorni_rimasti, 3);
  assert.equal(r.socio.nome, 'Scadenza');
  const acc = await q(`select * from accessi where socio_id=$1`, [s]);
  assert.equal(acc.length, 1);
  assert.equal(acc[0].ingresso, 'Terminale');
});

test('scaduto: motivo con data gg/mm', async () => {
  await socio('Scaduto', [{ piano: 'Open Mese', da: -40, a: -1 }], 'SCAD-KO');
  const r = await leggi('SCAD-KO');
  assert.equal(r.motivo_codice, 'scaduto');
  assert.match(r.motivo, /^Abbonamento scaduto il \d\d\/\d\d(\/\d{4})?$/);
});

test('archiviati ignorati -> nessun abbonamento', async () => {
  await socio('Archiviato', [{ piano: 'Open Mese', da: -10, a: 10, stato: 'archiviato' }], 'ARCH');
  assert.equal((await leggi('ARCH')).motivo, 'Nessun abbonamento');
});

test('carnet: scala atomicamente fino a esaurimento', async () => {
  const s = await socio('Carnet', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 2 }], 'CARNET');
  const r1 = await leggi('CARNET');
  assert.deepEqual([r1.esito, r1.residuo_prima, r1.residuo_dopo], ['ok', 2, 1]);
  const r2 = await leggi('CARNET');
  assert.deepEqual([r2.esito, r2.residuo_dopo], ['ok', 0]);
  const r3 = await leggi('CARNET');
  assert.equal(r3.motivo, 'Ingressi esauriti');
  assert.equal(await residuo(s), 0);
});

test('priorità: con scadenza valida il carnet non viene toccato', async () => {
  const s = await socio('Doppio', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 5 }, { piano: 'Open Mese', da: -5, a: 25 }], 'PRIO');
  const r = await leggi('PRIO');
  assert.equal(r.tipo, 'scadenza');
  assert.equal((await q(`select entrate_residue from abbonamenti where socio_id=$1 and entrate_residue is not null`, [s]))[0].entrate_residue, 5);
});

test('idempotenza: stesso evento_id due volte non scala due volte', async () => {
  const s = await socio('Idem', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 5 }], 'IDEM');
  const ev = randomUUID();
  const r1 = await leggi('IDEM', ev);
  const r2 = await leggi('IDEM', ev);
  assert.equal(r1.duplicato, false);
  assert.equal(r2.duplicato, true);
  assert.equal(r2.residuo_dopo, 4);
  assert.equal(await residuo(s), 4);
  assert.equal((await q('select count(*)::int n from accessi_log where evento_id=$1', [ev]))[0].n, 1);
});

test('stesso evento_id in parallelo (timeout + retry): una sola scalatura', async () => {
  const s = await socio('IdemPar', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 5 }], 'IDEMPAR');
  const ev = randomUUID();
  const rr = await Promise.all(Array.from({ length: 6 }, () => leggi('IDEMPAR', ev)));
  assert.equal(rr.filter((r) => !r.duplicato).length, 1);
  assert.equal(await residuo(s), 4);
});

test('accessi concorrenti sulla stessa tessera: mai sotto zero, esattamente N ok', async () => {
  const s = await socio('Concorrenza', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 3 }], 'CONC');
  const rr = await Promise.all(Array.from({ length: 12 }, () => leggi('CONC')));
  assert.equal(rr.filter((r) => r.esito === 'ok').length, 3);
  assert.equal(rr.filter((r) => r.motivo === 'Ingressi esauriti').length, 9);
  assert.equal(await residuo(s), 0);
  const dopo = rr.filter((r) => r.esito === 'ok').map((r) => r.residuo_dopo).sort();
  assert.deepEqual(dopo, [0, 1, 2]);
});

test('doppia lettura: registrata senza scalare', async () => {
  const s = await socio('Doppia', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 5 }], 'DOPPIA');
  await leggi('DOPPIA');
  const r = await leggi('DOPPIA', randomUUID(), { doppia: true });
  assert.equal(r.esito, 'doppia_lettura');
  assert.equal(await residuo(s), 4);
});

test('annullo ingresso: ripristina il residuo, toglie lo specchio, lascia traccia', async () => {
  const s = await socio('Annullo', [{ piano: 'Carnet 10', da: -5, a: 60, residuo: 5 }], 'ANN');
  const r = await leggi('ANN');
  assert.equal(await residuo(s), 4);
  const out = await staff((c) => c.query('select staff_annulla_ingresso($1, $2) r', [r.log_id, 'Passata per errore']).then((x) => x.rows[0].r));
  assert.equal(out.ingresso_ripristinato, true);
  assert.equal(await residuo(s), 5);
  assert.equal((await q('select count(*)::int n from accessi where socio_id=$1', [s]))[0].n, 0);
  const [orig] = await q('select * from accessi_log where id=$1', [r.log_id]);
  assert.ok(orig.annullato_il);
  const [tr] = await q(`select * from accessi_log where rif_log_id=$1`, [r.log_id]);
  assert.equal(tr.esito, 'annullo');
  assert.equal(tr.motivo, 'Passata per errore');
  await assert.rejects(staff((c) => c.query('select staff_annulla_ingresso($1)', [r.log_id])), /già annullato/);
});

test('assegnazione tessera: conferma se già di un altro socio, sostituzione', async () => {
  const a = await socio('Primo', [], 'COND');
  const b = await socio('Secondo', []);
  const r1 = await staff((c) => c.query('select staff_assegna_tessera($1,$2) r', [b, 'cond']).then((x) => x.rows[0].r));
  assert.equal(r1.stato, 'conferma');
  assert.equal(r1.altro_socio.nome, 'Primo');
  const r2 = await staff((c) => c.query(`select staff_assegna_tessera($1,$2,'aggiungi',true) r`, [b, 'COND']).then((x) => x.rows[0].r));
  assert.equal(r2.stato, 'ok');
  const att = await q(`select socio_id from tessere where codice='COND' and attiva`);
  assert.deepEqual(att.map((x) => x.socio_id), [b]);
  assert.equal((await q(`select motivo_disattivazione m from tessere where socio_id=$1`, [a]))[0].m, 'Riassegnata a Secondo Test');
  await staff((c) => c.query(`select staff_assegna_tessera($1,'NUOVA','sostituisci')`, [b]));
  assert.deepEqual((await q(`select codice from tessere where socio_id=$1 and attiva`, [b])).map((x) => x.codice), ['NUOVA']);
});

test('tessere lette non associate: compaiono e spariscono dopo l\'assegnazione', async () => {
  await leggi('ORFANA-1');
  await leggi('ORFANA-1');
  let lista = await staff((c) => c.query('select * from staff_tessere_non_associate()').then((x) => x.rows));
  assert.equal(lista.find((x) => x.codice === 'ORFANA-1').letture, '2');
  const s = await socio('Orfana', []);
  await staff((c) => c.query(`select staff_assegna_tessera($1,'ORFANA-1')`, [s]));
  lista = await staff((c) => c.query('select * from staff_tessere_non_associate()').then((x) => x.rows));
  assert.equal(lista.find((x) => x.codice === 'ORFANA-1'), undefined);
});

test('ruolo terminale: token errato rifiutato', async () => {
  await assert.rejects(leggi('X', randomUUID(), { token: 'sbagliato' }), /non autorizzato/);
  const t2 = await staff((c) => c.query(`select staff_crea_terminale('Revocato') r`).then((x) => x.rows[0].r));
  await staff((c) => c.query('select staff_revoca_terminale($1)', [t2.id]));
  await assert.rejects(leggi('X', randomUUID(), { token: t2.token }), /non autorizzato/);
});

test('ruolo terminale (anon): nessuna lettura di tabelle, nessuna funzione staff', async () => {
  for (const t of ['soci', 'abbonamenti', 'tessere', 'accessi_log', 'accessi']) {
    const rows = await anon((c) => c.query(`select * from ${t}`).then((r) => r.rows).catch(() => []));
    assert.equal(rows.length, 0, `anon legge ${t}`);
  }
  await assert.rejects(anon((c) => c.query(`select * from terminali`)), /permission denied/);
  await assert.rejects(anon((c) => c.query(`select staff_crea_terminale('x')`)), /permission denied/);
  await assert.rejects(anon((c) => c.query(`select accessi_esegui(null,'x',gen_random_uuid(),now())`)), /permission denied/);
  await assert.rejects(anon((c) => c.query(`insert into tessere(codice,socio_id) values ('X', gen_random_uuid())`)), /permission denied/);
  // lo staff non vede l'hash del token
  await assert.rejects(staff((c) => c.query(`select token_hash from terminali`)), /permission denied/);
  assert.ok((await staff((c) => c.query(`select nome from terminali`))).rows.length >= 1);
});

test('giorno di riferimento in Europe/Rome', async () => {
  // il giorno di oggi del DB coincide con quello calcolato in JS
  const { oggiRoma } = await import('../../app/js/esito.js');
  assert.equal(await oggiDb(), oggiRoma());
});

test('seed di sviluppo: bloccato senza consenso; le tessere SIM danno gli stessi esiti della demo in memoria', async () => {
  const sql = readFileSync(new URL('../../sql/seed-dev.sql', import.meta.url), 'utf8');
  await assert.rejects(q(sql), /Seed demo bloccato/);
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('gymin.consenti_seed_demo','si',true)`);
    await c.query(sql);
    await c.query('commit');
  } finally { c.release(); }
  const { creaSorgenteDemo } = await import('../../app/js/dataLayer.js');
  const { TESSERE_TEST, ALTRI_CASI } = await import('../../app/js/demo.js');
  const demo = creaSorgenteDemo();
  const tokenDev = 'dev-terminale-SOLO-SVILUPPO';
  for (const { codice } of [...TESSERE_TEST, ...ALTRI_CASI]) {
    const db = await leggi(codice, randomUUID(), { token: tokenDev });
    const mem = await demo.registraLettura({ codice, evento_id: randomUUID(), ts: new Date().toISOString() });
    for (const k of ['esito', 'motivo_codice', 'motivo', 'tipo', 'residuo_dopo', 'giorni_rimasti']) {
      assert.equal(db[k] ?? null, mem[k] ?? null, `${codice} · ${k}`);
    }
  }
});
