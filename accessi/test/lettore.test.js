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
