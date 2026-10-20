// node --test web/js/qrmail.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { matriceQr, tabellaQrHtml } from './qrmail.js';

const carica = (rel, nome) => { const ctx = {}; runInNewContext(`${readFileSync(new URL(rel, import.meta.url), 'utf8')};this.${nome}=${nome};`, ctx); return ctx[nome]; };
const qrcode = carica('../vendor/qrcode.js', 'qrcode');
const jsQR = (() => { const ctx = { window: {} }; ctx.self = ctx.window; runInNewContext(readFileSync(new URL('../../accessi/app/vendor/jsQR.js', import.meta.url), 'utf8'), ctx); return ctx.jsQR || ctx.window.jsQR; })();
const CODICE = 'QR0123456789ABCDEF0123456789ABCDEF';

test('QR email: la matrice si rilegge con lo stesso decodificatore del terminale', () => {
  const m = matriceQr(CODICE, qrcode);
  const px = 6, marg = 4, n = (m.length + 2 * marg) * px;
  const img = new Uint8ClampedArray(n * n * 4).fill(255);
  m.forEach((riga, r) => riga.forEach((scuro, c) => {
    if (!scuro) return;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = (((r + marg) * px + y) * n + (c + marg) * px + x) * 4;
      img[i] = img[i + 1] = img[i + 2] = 0;
    }
  }));
  assert.equal(jsQR(img, n, n)?.data, CODICE);
});

test('QR email: tabella HTML compatta, celle unite e larghezza fissa', () => {
  const m = matriceQr(CODICE, qrcode);
  const html = tabellaQrHtml(m);
  assert.ok(html.length < 60_000, `${html.length} byte`);
  assert.match(html, /colspan="\d+"/);
  // ogni riga visibile copre esattamente tutte le colonne
  const n = m.length + 8;
  const righe = html.split('<tr>').slice(2);
  assert.equal(righe.length, n);
  for (const r of righe) {
    const tot = [...r.matchAll(/<td(?: colspan="(\d+)")?/g)].reduce((s, x) => s + Number(x[1] || 1), 0);
    assert.equal(tot, n);
  }
});
