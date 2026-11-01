// node --test web/js/qrmail.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { matriceQr, tabellaQrHtml, latoLogo } from './qrmail.js';

const carica = (rel, nome) => { const ctx = {}; runInNewContext(`${readFileSync(new URL(rel, import.meta.url), 'utf8')};this.${nome}=${nome};`, ctx); return ctx[nome]; };
const qrcode = carica('../vendor/qrcode.js', 'qrcode');
const jsQR = (() => { const ctx = { window: {} }; ctx.self = ctx.window; runInNewContext(readFileSync(new URL('../../accessi/app/vendor/jsQR.js', import.meta.url), 'utf8'), ctx); return ctx.jsQR || ctx.window.jsQR; })();
const CODICE = 'QR0123456789ABCDEF0123456789ABCDEF';

// immagine in scala di grigi (RGBA) del QR; `centro(x, y)` decide i pixel dell'area del logo
function disegna(m, centro = null) {
  const px = 6, marg = 4, n = (m.length + 2 * marg) * px;
  const k = latoLogo(m.length), z0 = (m.length - k) / 2;
  const img = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.floor(y / px) - marg, c = Math.floor(x / px) - marg;
    if (r < 0 || c < 0 || r >= m.length || c >= m.length) continue;
    const zona = centro && r >= z0 && r < z0 + k && c >= z0 && c < z0 + k;
    if (zona ? centro(x, y) : m[r][c]) { const i = (y * n + x) * 4; img[i] = img[i + 1] = img[i + 2] = 0; }
  }
  return { img, n };
}

test('QR email: la matrice si rilegge con lo stesso decodificatore del terminale', () => {
  const { img, n } = disegna(matriceQr(CODICE, qrcode));
  assert.equal(jsQR(img, n, n)?.data, CODICE);
});

test('QR email con logo: si legge con il centro bianco (immagine bloccata) e con il centro pieno di segni', () => {
  const m = matriceQr(CODICE, qrcode);
  for (const centro of [() => false, (x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0]) {
    const { img, n } = disegna(m, centro);
    assert.equal(jsQR(img, n, n)?.data, CODICE);
  }
});

test('QR email: tabella HTML compatta, celle unite e larghezza fissa', () => {
  const m = matriceQr(CODICE, qrcode);
  const n = m.length + 8, k = latoLogo(m.length), z0 = 4 + (m.length - k) / 2;
  for (const logo of [null, 'https://esempio.it/img/logo.png']) {
    const html = tabellaQrHtml(m, { logo });
    assert.ok(html.length < 75_000, `${html.length} byte`);
    assert.match(html, /colspan="\d+"/);
    assert.equal(html.includes('<img'), !!logo);
    // ogni riga visibile copre esattamente tutte le colonne (sotto la cella del logo, con rowspan, ne mancano k)
    const righe = html.split('<tr>').slice(2);
    assert.equal(righe.length, n);
    righe.forEach((r, i) => {
      const tot = [...r.matchAll(/<td(?: rowspan="\d+")?(?: colspan="(\d+)")?/g)].reduce((s, x) => s + Number(x[1] || 1), 0);
      assert.equal(tot, logo && i > z0 && i < z0 + k ? n - k : n);
    });
  }
});
