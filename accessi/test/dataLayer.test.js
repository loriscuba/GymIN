import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaSorgenteRemota, creaSorgenteDemo, creaDataLayerTerminale, ErroreRete, ErroreAutorizzazione } from '../app/js/dataLayer.js';

const risposta = (status, corpo) => ({ ok: status < 400, status, text: async () => JSON.stringify(corpo) });

test('remota: chiama la RPC con chiave anon, token ed evento_id (nessuna chiave admin)', async () => {
  let chiamata;
  const src = creaSorgenteRemota({ url: 'https://x.supabase.co/', anonKey: 'ANON', schema: 'test', token: 'TOK',
    fetchFn: async (url, opz) => { chiamata = { url, opz }; return risposta(200, { esito: 'ok' }); } });
  const r = await src.registraLettura({ codice: 'ABC', evento_id: 'e1', ts: '2026-10-06T10:00:00Z' });
  assert.equal(r.esito, 'ok');
  assert.equal(chiamata.url, 'https://x.supabase.co/rest/v1/rpc/terminale_accesso');
  assert.equal(chiamata.opz.headers.apikey, 'ANON');
  assert.equal(chiamata.opz.headers['Content-Profile'], 'test');
  assert.deepEqual(JSON.parse(chiamata.opz.body), { p_token: 'TOK', p_codice: 'ABC', p_evento_id: 'e1', p_ts_terminale: '2026-10-06T10:00:00Z', p_doppia: false });
});

test('remota: timeout -> ErroreRete(timeout)', async () => {
  const src = creaSorgenteRemota({ url: 'u', anonKey: 'k', token: 't', timeoutMs: 30,
    fetchFn: (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort')))) });
  await assert.rejects(src.registraLettura({ codice: 'A', evento_id: 'e' }), (e) => e instanceof ErroreRete && e.tipo === 'timeout');
});

test('remota: token revocato -> ErroreAutorizzazione; errore 5xx -> ErroreRete', async () => {
  const a = creaSorgenteRemota({ url: 'u', anonKey: 'k', token: 't', fetchFn: async () => risposta(403, { code: '28000', message: 'Terminale non autorizzato' }) });
  await assert.rejects(a.ping(), ErroreAutorizzazione);
  const b = creaSorgenteRemota({ url: 'u', anonKey: 'k', token: 't', fetchFn: async () => risposta(503, {}) });
  await assert.rejects(b.ping(), ErroreRete);
});

test('demo: scala il carnet in memoria ed è idempotente sullo stesso evento', async () => {
  const d = creaSorgenteDemo();
  const r1 = await d.registraLettura({ codice: 'sim0000002', evento_id: 'e1', ts: new Date().toISOString() });
  assert.deepEqual([r1.esito, r1.residuo_dopo], ['ok', 2]);
  const r2 = await d.registraLettura({ codice: 'SIM0000002', evento_id: 'e1', ts: new Date().toISOString() });
  assert.equal(r2.duplicato, true);
  const r3 = await d.registraLettura({ codice: 'SIM0000002', evento_id: 'e2', ts: new Date().toISOString() });
  assert.equal(r3.residuo_dopo, 1);
  assert.equal((await d.registraLettura({ codice: 'SIM0000008', evento_id: 'e3' })).motivo, 'Tessera sconosciuta');
});

test('scelta sorgente: remota con config+token, demo solo in simulazione senza config, altrimenti setup', () => {
  const cfg = { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'k' };
  assert.equal(creaDataLayerTerminale({ config: cfg, token: 't' }).tipo, 'remoto');
  assert.equal(creaDataLayerTerminale({ config: cfg, token: null, sim: true }), null);
  assert.equal(creaDataLayerTerminale({ config: {}, sim: true }).tipo, 'demo');
  assert.equal(creaDataLayerTerminale({ config: {} }), null);
  assert.equal(creaDataLayerTerminale({ config: cfg, token: 't', demo: true }).tipo, 'demo');
});
