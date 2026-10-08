import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriviMeteo, leggiMeteo, scaricaMeteo } from '../app/js/meteo.js';

test('descriviMeteo: codici WMO in italiano', () => {
  assert.equal(descriviMeteo(0).testo, 'Sereno');
  assert.equal(descriviMeteo(63).testo, 'Pioggia');
  assert.equal(descriviMeteo(95).testo, 'Temporale');
  assert.equal(descriviMeteo(999).testo, '');
});

test('leggiMeteo: arrotonda e gestisce dati mancanti', () => {
  const m = leggiMeteo({ current: { temperature_2m: 18.6, weather_code: 2 },
    daily: { temperature_2m_min: [12.4], temperature_2m_max: [21.5], precipitation_probability_max: [30] } });
  assert.deepEqual(m, { testo: 'Parzialmente nuvoloso', icona: '⛅', temp: 19, min: 12, max: 22, pioggia: 30 });
  assert.equal(leggiMeteo({}), null);
  assert.equal(leggiMeteo({ current: { temperature_2m: 5, weather_code: 0 } }).min, null);
});

test('scaricaMeteo: errore HTTP', async () => {
  await assert.rejects(scaricaMeteo(1, 2, { fetch: async () => ({ ok: false, status: 500 }) }), /500/);
});
