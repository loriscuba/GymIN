import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaAccumulatore } from '../app/js/lettore.js';

const raffica = (acc, testo, t0, passo = 8) => {
  let out = null;
  [...testo, 'Enter'].forEach((k, i) => { out = acc.feed(k, t0 + i * passo) ?? out; });
  return out;
};

test('lettore: codice a raffica + Invio viene consegnato normalizzato', () => {
  const acc = creaAccumulatore();
  assert.equal(raffica(acc, '0012345678', 1000), '0012345678');
  assert.equal(raffica(acc, 'ab 12', 5000), 'AB12');
});

test('lettore: battitura lenta a mano ignorata', () => {
  const acc = creaAccumulatore();
  assert.equal(raffica(acc, '1234', 1000, 180), null);
});

test('lettore: caratteri lenti prima della raffica non sporcano il codice', () => {
  const acc = creaAccumulatore();
  acc.feed('x', 100);
  acc.feed('y', 400);
  assert.equal(raffica(acc, '0099887766', 2000), '0099887766');
});

test('lettore: Invio lento dopo la raffica = scartato; la lettura successiva funziona', () => {
  const acc = creaAccumulatore();
  '12345'.split('').forEach((k, i) => acc.feed(k, 1000 + i * 5));
  assert.equal(acc.feed('Enter', 2000), null);
  assert.equal(raffica(acc, '55555', 3000), '55555');
});

test('lettore: lunghezza e formato liberi', () => {
  const acc = creaAccumulatore();
  assert.equal(raffica(acc, 'A', 1000), 'A');
  assert.equal(raffica(acc, '04A1B2C3D4E5F6', 2000), '04A1B2C3D4E5F6');
});

test('lettore reale EM4100: "0003827938" + Invio, zeri iniziali conservati', () => {
  const acc = creaAccumulatore();
  assert.equal(raffica(acc, '0003827938', 1000, 12), '0003827938');
});

test('lettore lento (70 ms tra i tasti) accettato con la soglia predefinita; a mano no', () => {
  const acc = creaAccumulatore();
  assert.equal(raffica(acc, '0003827938', 1000, 70), '0003827938');
  assert.equal(raffica(acc, '0003827938', 9000, 150), null);
});

test('lettore che chiude con Tab invece di Invio', () => {
  const acc = creaAccumulatore();
  let out = null;
  [...'0003827938', 'Tab'].forEach((k, i) => { out = acc.feed(k, 1000 + i * 8) ?? out; });
  assert.equal(out, '0003827938');
});

test('diagnostica: misura caratteri e intervalli anche quando scarta', () => {
  const acc = creaAccumulatore({ maxGapMs: 50 });
  raffica(acc, '0003827938', 1000, 10);
  const ok = acc.ultimaRaffica();
  assert.deepEqual([ok.codice, ok.accettato, ok.caratteri, ok.gapMaxMs, ok.durataMs], ['0003827938', true, 10, 10, 100]);
  // il lettore va lento: 70 ms > soglia 50 -> la diagnostica lo dice
  '0003827938'.split('').forEach((k, i) => acc.feed(k, 5000 + i * 70));
  acc.feed('Enter', 5000 + 10 * 70);
  const ko = acc.ultimaRaffica();
  assert.equal(ko.accettato, false);
  assert.equal(ko.codice, '0003827938', 'la diagnostica mostra comunque il codice completo');
  assert.equal(ko.caratteri, 10);
  assert.equal(ko.gapMaxMs, 70);
  assert.equal(ko.sogliaMs, 50);
});
