import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estraiCodiceQr, creaFiltroQr } from '../app/js/fotocamera.js';

const QR = 'QR00000000000000000000000000000001';

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
