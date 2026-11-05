import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estraiCodiceQr, creaFiltroQr, creaSentinella, attesaRiavvio } from '../app/js/fotocamera.js';

const QR = 'QR00000000000000000000000000000001';

test('sentinella: video che avanza = ok; immagine ferma per 10 s = riavvio', () => {
  const s = creaSentinella({ maxFermoMs: 10000 });
  for (let t = 0; t <= 60000; t += 250) assert.equal(s.controlla({ live: true, tempoVideo: t / 1000, ora: t }), false);
  // da qui il tempo del video non avanza più (standby, driver USB...)
  assert.equal(s.controlla({ live: true, tempoVideo: 60, ora: 65000 }), false);
  assert.equal(s.controlla({ live: true, tempoVideo: 60, ora: 69999 }), false);
  assert.equal(s.controlla({ live: true, tempoVideo: 60, ora: 70000 }), true);
});

test('sentinella: traccia chiusa o muta = riavvio subito; dopo reset riparte da zero', () => {
  const s = creaSentinella();
  assert.equal(s.controlla({ live: false, tempoVideo: 1, ora: 0 }), true);
  s.reset();
  assert.equal(s.controlla({ live: true, tempoVideo: 5, ora: 100000 }), false);
});

test('riavvio fotocamera: attese crescenti, al massimo 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 50].map(attesaRiavvio), [2000, 5000, 10000, 30000, 30000, 30000]);
});

test('fotocamera: accetta solo i QR d\'ingresso, normalizzati', () => {
  assert.equal(estraiCodiceQr(QR), QR);
  assert.equal(estraiCodiceQr(` ${QR.toLowerCase()} `), QR);
  assert.equal(estraiCodiceQr('https://example.com/menu'), null);
  assert.equal(estraiCodiceQr('QR123'), null);
  assert.equal(estraiCodiceQr(null), null);
});

test('fotocamera: lo stesso QR tenuto davanti vale una sola lettura', () => {
  const f = creaFiltroQr({ assenzaMs: 1500 });
  assert.equal(f.vedi(QR, 0), QR);
  for (let t = 250; t <= 6000; t += 250) assert.equal(f.vedi(QR, t), null, `t=${t}`);
});

test('fotocamera: tolto e rimostrato dopo la pausa → nuova lettura; fotogrammi persi non contano', () => {
  const f = creaFiltroQr({ assenzaMs: 1500 });
  f.vedi(QR, 0);
  assert.equal(f.vedi(null, 500), null);
  assert.equal(f.vedi(QR, 750), null, 'un fotogramma senza QR non basta');
  f.vedi(null, 1000);
  f.vedi(null, 2400);
  assert.equal(f.vedi(QR, 2600), QR);
});

test('fotocamera: un QR diverso viene letto subito', () => {
  const f = creaFiltroQr();
  const altro = 'QR' + 'A'.repeat(32);
  f.vedi(QR, 0);
  assert.equal(f.vedi(altro, 250), altro);
});
