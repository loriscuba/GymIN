import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decidiAbbonamenti, decidiAccesso, avviso, normalizzaCodice, creaFiltroDoppie, oggiRoma, fmtData, inizioGiornoRoma, fmtDataOra,
} from '../app/js/esito.js';

const { casi } = JSON.parse(readFileSync(new URL('./casi-esito.json', import.meta.url)));

for (const c of casi) {
  test(`regole: ${c.nome}`, () => {
    const r = decidiAbbonamenti(c.abbonamenti, c.oggi);
    for (const [k, v] of Object.entries(c.atteso)) assert.equal(r[k], v, `${k}`);
  });
}

test('tessera sconosciuta o disattivata', () => {
  const abb = casi[1].abbonamenti;
  assert.equal(decidiAccesso({ tessera: null, abbonamenti: abb, oggi: '2026-10-06' }).motivo, 'Tessera sconosciuta');
  const dis = decidiAccesso({ tessera: { id: 't', attiva: false }, abbonamenti: abb, oggi: '2026-10-06' });
  assert.equal(dis.esito, 'negato');
  assert.equal(dis.motivo_codice, 'tessera_sconosciuta');
  const ok = decidiAccesso({ tessera: { id: 't', attiva: true }, socio: { nome: 'A' }, abbonamenti: abb, oggi: '2026-10-06' });
  assert.equal(ok.esito, 'ok');
  assert.equal(ok.socio.nome, 'A');
});

test('normalizzazione codice: maiuscolo e senza spazi, formato libero', () => {
  assert.equal(normalizzaCodice(' 00a1 b2\t'), '00A1B2');
  assert.equal(normalizzaCodice('0012345678'), '0012345678');
  assert.equal(normalizzaCodice(null), '');
});

test('avviso giallo', () => {
  assert.equal(avviso({ esito: 'negato' }), null);
  assert.equal(avviso({ esito: 'ok', tipo: 'scadenza', giorni_rimasti: 7 }), null);
  assert.equal(avviso({ esito: 'ok', tipo: 'scadenza', giorni_rimasti: 6 }), 'Scade tra 6 giorni');
  assert.equal(avviso({ esito: 'ok', tipo: 'scadenza', giorni_rimasti: 1 }), 'Scade domani');
  assert.equal(avviso({ esito: 'ok', tipo: 'scadenza', giorni_rimasti: 0 }), 'Scade oggi');
  assert.equal(avviso({ esito: 'ok', tipo: 'ingressi', residuo_dopo: 3, giorni_rimasti: 30 }), null);
  assert.equal(avviso({ esito: 'ok', tipo: 'ingressi', residuo_dopo: 2, giorni_rimasti: 30 }), 'Restano 2 ingressi');
  assert.equal(avviso({ esito: 'ok', tipo: 'ingressi', residuo_dopo: 1, giorni_rimasti: 30 }), 'Resta 1 ingresso');
  assert.equal(avviso({ esito: 'ok', tipo: 'ingressi', residuo_dopo: 0, giorni_rimasti: 3 }), 'Ultimo ingresso del carnet · Scade tra 3 giorni');
});

test('doppia lettura entro 5 secondi ignorata, poi di nuovo valida', () => {
  const f = creaFiltroDoppie(5000);
  assert.equal(f.controlla('AAA', 1000), false);
  assert.equal(f.controlla('AAA', 3000), true);
  assert.equal(f.controlla('BBB', 3500), false, 'tessera diversa non è doppia');
  assert.equal(f.controlla('AAA', 5999), true);
  assert.equal(f.controlla('AAA', 6000), false, 'dopo 5 s si rielabora');
});

test('data di oggi in Europe/Rome e formato gg/mm', () => {
  assert.equal(oggiRoma(new Date('2026-10-05T22:30:00Z')), '2026-10-06');   // 00:30 a Roma (CEST)
  assert.equal(oggiRoma(new Date('2026-12-31T23:30:00Z')), '2027-01-01');   // 00:30 a Roma (CET)
  assert.equal(fmtData('2026-03-09', '2026-10-06'), '09/03');
  assert.equal(fmtData('2025-03-09', '2026-10-06'), '09/03/2025');
});

test('mezzanotte a Roma e formato gg/mm/aaaa hh:mm', () => {
  assert.equal(inizioGiornoRoma('2026-10-06'), '2026-10-05T22:00:00.000Z');   // CEST
  assert.equal(inizioGiornoRoma('2026-12-01'), '2026-11-30T23:00:00.000Z');   // CET
  assert.equal(fmtDataOra('2026-10-06T12:05:00Z'), '06/10/2026 14:05');
});
