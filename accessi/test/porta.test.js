import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlApertura, configPorta, creaApriporta } from '../app/js/porta.js';
import { creaShellyFinto } from '../scripts/shelly-finto.mjs';

test('porta: URL Gen2 (RPC Switch.Set con impulso) e Gen1 (/relay)', () => {
  assert.equal(urlApertura({ url: 'http://192.168.1.50/' }), 'http://192.168.1.50/rpc/Switch.Set?id=0&on=true&toggle_after=1');
  assert.equal(urlApertura({ url: 'http://10.0.0.9', canale: 1, impulsoS: 2 }), 'http://10.0.0.9/rpc/Switch.Set?id=1&on=true&toggle_after=2');
  assert.equal(urlApertura({ url: 'http://10.0.0.9', gen: 1 }), 'http://10.0.0.9/relay/0?turn=on&timer=1');
  assert.throws(() => urlApertura({ url: '192.168.1.50' }), /non valido/);
});

test('porta: configurazione (indirizzo salvato sul PC > build; simulazione)', () => {
  assert.equal(configPorta({}).tipo, '');
  assert.equal(configPorta({}, { sim: true }).tipo, 'sim');
  assert.equal(configPorta({ SHELLY_URL: 'http://a' }).tipo, 'shelly');
  assert.equal(configPorta({ SHELLY_URL: 'http://a' }, { shellyUrl: 'http://b' }).url, 'http://b');
  assert.equal(configPorta({ PORTA_TIPO: 'shelly' }).tipo, '', 'shelly senza indirizzo = spento');
  assert.equal(configPorta({ PORTA_TIPO: 'sim', SHELLY_URL: 'http://a' }).tipo, 'sim');
});

test('porta: spenta non chiama la rete', async () => {
  let chiamate = 0;
  const p = creaApriporta(configPorta({}), { fetch: async () => { chiamate++; } });
  assert.equal(p.attivo, false);
  assert.deepEqual((await p.apri()).saltato, true);
  assert.equal(chiamate, 0);
});

test('porta: simulata = ok senza rete', async () => {
  const p = creaApriporta(configPorta({}, { sim: true }), { fetch: async () => { throw new Error('no'); } });
  const e = await p.apri();
  assert.equal(e.ok, true);
  assert.equal(e.simulato, true);
});

test('porta: errori HTTP e di rete non lanciano, restituiscono il motivo', async () => {
  const cfg = configPorta({ SHELLY_URL: 'http://x' });
  const e500 = await creaApriporta(cfg, { fetch: async () => ({ ok: false, status: 500 }) }).apri();
  assert.equal(e500.ok, false);
  assert.match(e500.errore, /HTTP 500/);
  const eRete = await creaApriporta(cfg, { fetch: async () => { throw new TypeError('Failed to fetch'); } }).apri();
  assert.equal(eRete.ok, false);
  assert.match(eRete.errore, /non raggiungibile/);
});

test('porta: timeout se lo Shelly non risponde', async () => {
  const cfg = configPorta({ SHELLY_URL: 'http://x', PORTA_TIMEOUT_MS: 30 });
  const lento = (url, { signal }) => new Promise((_, ko) => signal.addEventListener('abort', () => ko(new Error('aborted'))));
  const e = await creaApriporta(cfg, { fetch: lento }).apri();
  assert.equal(e.ok, false);
  assert.match(e.errore, /entro 30 ms/);
});

test('porta: due aperture ravvicinate = un solo comando', async () => {
  let chiamate = 0;
  const p = creaApriporta(configPorta({ SHELLY_URL: 'http://x' }), {
    fetch: () => { chiamate++; return new Promise((ok) => setTimeout(() => ok({ ok: true, status: 200 }), 10)); },
  });
  const [a, b] = await Promise.all([p.apri(), p.apri()]);
  assert.equal(chiamate, 1);
  assert.equal(a, b);
  await p.apri();
  assert.equal(chiamate, 2, 'finito il primo, il successivo riparte');
});

// --- integrazione con lo Shelly finto (HTTP vero su localhost) ---------------------------
async function conShellyFinto(opz, fn) {
  const finto = creaShellyFinto(opz);
  await new Promise((ok) => finto.server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${finto.server.address().port}`;
  try { await fn(finto, url); } finally { await new Promise((ok) => finto.server.close(ok)); }
}

test('integrazione: Gen2 apre il relè per l\'impulso e poi si richiude', async () => {
  await conShellyFinto({}, async (finto, url) => {
    const p = creaApriporta(configPorta({ SHELLY_URL: url, PORTA_IMPULSO_S: 0.05 }));
    const e = await p.apri();
    assert.equal(e.ok, true, e.errore);
    assert.equal(finto.stato.output, true);
    assert.equal(finto.aperture.length, 1);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(finto.stato.output, false, 'fine impulso: relè di nuovo aperto');
  });
});

test('integrazione: Gen1 (/relay/0)', async () => {
  await conShellyFinto({}, async (finto, url) => {
    const e = await creaApriporta(configPorta({ SHELLY_URL: url, SHELLY_GEN: 1 })).apri();
    assert.equal(e.ok, true, e.errore);
    assert.equal(finto.aperture.length, 1);
  });
});

test('integrazione: Shelly in errore o lento → esito negativo, nessuna eccezione', async () => {
  await conShellyFinto({ errore: true }, async (_, url) => {
    const e = await creaApriporta(configPorta({ SHELLY_URL: url })).apri();
    assert.equal(e.ok, false);
    assert.match(e.errore, /HTTP 500/);
  });
  await conShellyFinto({ ritardoMs: 300 }, async (finto, url) => {
    const e = await creaApriporta(configPorta({ SHELLY_URL: url, PORTA_TIMEOUT_MS: 50 })).apri();
    assert.equal(e.ok, false);
    assert.match(e.errore, /entro 50 ms/);
  });
});

test('integrazione: Shelly spento (porta chiusa) → non raggiungibile', async () => {
  const finto = creaShellyFinto();
  await new Promise((ok) => finto.server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${finto.server.address().port}`;
  await new Promise((ok) => finto.server.close(ok));
  const e = await creaApriporta(configPorta({ SHELLY_URL: url })).apri();
  assert.equal(e.ok, false);
  assert.match(e.errore, /non raggiungibile/);
});
