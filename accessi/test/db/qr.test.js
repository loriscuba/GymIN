// QR d'ingresso: creazione per lo staff, anti-condivisione, rigenerazione. Avvio: npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { preparaDb, come } from './helper.mjs';

let pool, token;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const staff = (fn) => come(pool, 'authenticated', fn);
const anon = (fn) => come(pool, 'anon', fn);
const qrDi = (socioId, rigenera = false) =>
  staff((c) => c.query('select staff_qr_socio($1,$2) r', [socioId, rigenera]).then((r) => r.rows[0].r));
const leggi = (codice, ts = new Date().toISOString(), evento = randomUUID()) =>
  anon((c) => c.query('select terminale_accesso($1,$2,$3,$4) r', [token, codice, evento, ts]).then((r) => r.rows[0].r));
const sync = (eventi) =>
  anon((c) => c.query('select terminale_sync($1,$2::jsonb) r', [token, JSON.stringify(eventi)]).then((r) => r.rows[0].r));

async function socioValido(nome, piano = 'Open Mese', residuo = null) {
  const [{ id }] = await q(`insert into soci(nome,cognome) values ($1,'QR') returning id`, [nome]);
  await q(`insert into abbonamenti(socio_id,piano_id,data_inizio,data_scadenza,entrate_residue,stato)
           values ($1,(select id from piani where nome=$2),current_date - 5, current_date + 25, $3, 'attivo')`, [id, piano, residuo]);
  return id;
}

before(async () => {
  pool = await preparaDb();
  await q(`insert into piani(nome,prezzo,durata_mesi,entrate) values ('Open Mese',50,1,0),('Carnet 10',80,6,10)`);
  token = await staff((c) => c.query(`select staff_crea_terminale('Ingresso QR') r`).then((r) => r.rows[0].r.token));
});
after(() => pool?.end());

test('staff_qr_socio: crea un QR non indovinabile e restituisce sempre lo stesso', async () => {
  const s = await socioValido('Anna');
  const a = await qrDi(s);
  assert.match(a.codice, /^QR[0-9A-F]{32}$/);
  const b = await qrDi(s);
  assert.equal(b.codice, a.codice);
  const [{ tipo }] = await q('select tipo from tessere where id=$1', [a.tessera_id]);
  assert.equal(tipo, 'qr');
});

test('staff_qr_socio: anon non può chiamarla, le tessere esistenti restano rfid', async () => {
  const s = await socioValido('Bruno');
  await assert.rejects(anon((c) => c.query('select staff_qr_socio($1)', [s])), /permission denied/);
  await staff((c) => c.query('select staff_assegna_tessera($1,$2)', [s, '0001112223']));
  const [{ tipo }] = await q(`select tipo from tessere where codice='0001112223'`);
  assert.equal(tipo, 'rfid');
});

test('QR valido: entra; lo stesso QR entro 4 ore viene respinto ("QR già usato")', async () => {
  const s = await socioValido('Carla');
  const { codice } = await qrDi(s);
  const r1 = await leggi(codice);
  assert.equal(r1.esito, 'ok');
  const r2 = await leggi(codice);
  assert.equal(r2.esito, 'negato');
  assert.equal(r2.motivo_codice, 'qr_gia_usato');
  assert.match(r2.motivo, /^QR già usato alle \d\d:\d\d$/);
  // dopo la finestra si rientra
  const tra5ore = new Date(Date.now() + 5 * 3600e3).toISOString();
  const [{ r: r3 }] = await anon((c) => c.query(`select terminale_sync($1, $2::jsonb) r`, [token, JSON.stringify([
    { evento_id: randomUUID(), codice, ts: tra5ore, esito: { esito: 'ok', socio_id: s } }])]).then((x) => x.rows));
  assert.equal(r3.risultati[0].esito, 'ok');
  assert.equal(r3.risultati[0].da_verificare, false);
});

test('QR: un ingresso annullato dallo staff non blocca il successivo', async () => {
  const s = await socioValido('Dario');
  const { codice } = await qrDi(s);
  const r1 = await leggi(codice);
  await staff((c) => c.query('select staff_annulla_ingresso($1)', [r1.log_id]));
  assert.equal((await leggi(codice)).esito, 'ok');
});

test('QR su carnet: il secondo passaggio respinto non scala ingressi', async () => {
  const s = await socioValido('Elisa', 'Carnet 10', 5);
  const { codice } = await qrDi(s);
  await leggi(codice);
  await leggi(codice);
  const [{ r }] = await q('select entrate_residue r from abbonamenti where socio_id=$1', [s]);
  assert.equal(r, 4);
});

test('tessera RFID: nessun blocco anti-condivisione (comportamento invariato)', async () => {
  const s = await socioValido('Franco');
  await staff((c) => c.query('select staff_assegna_tessera($1,$2)', [s, '0009998887']));
  assert.equal((await leggi('0009998887')).esito, 'ok');
  assert.equal((await leggi('0009998887')).esito, 'ok');
});

test('QR rigenerato: il vecchio diventa "tessera sconosciuta", il nuovo entra', async () => {
  const s = await socioValido('Gina');
  const vecchio = (await qrDi(s)).codice;
  const nuovo = (await qrDi(s, true)).codice;
  assert.notEqual(nuovo, vecchio);
  assert.equal((await leggi(vecchio)).motivo_codice, 'tessera_sconosciuta');
  assert.equal((await leggi(nuovo)).esito, 'ok');
});

test('QR offline: secondo ingresso entro la finestra → registrato "da verificare", senza scalare', async () => {
  const s = await socioValido('Ivo', 'Carnet 10', 5);
  const { codice } = await qrDi(s);
  const t0 = Date.now() - 3600e3;
  const ev = (min) => ({ evento_id: randomUUID(), codice, ts: new Date(t0 + min * 60e3).toISOString(),
    esito: { esito: 'ok', socio_id: s, tipo: 'ingressi' } });
  const out = await sync([ev(0), ev(30)]);
  assert.deepEqual(out.risultati.map((x) => [x.esito, x.da_verificare]), [['ok', false], ['ok', true]]);
  const [{ r }] = await q('select entrate_residue r from abbonamenti where socio_id=$1', [s]);
  assert.equal(r, 4);
});
