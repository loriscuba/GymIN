// Dati DEMO per la modalità simulazione (?sim=1) senza database: vivono solo in memoria.
// Gli stessi soci/codici sono in sql/seed-dev.sql per il database di SVILUPPO.
// Date relative a oggi (Europe/Rome).
import { oggiRoma } from './esito.js';

const piu = (oggi, n) => {
  const d = new Date(`${oggi}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const TESSERE_TEST = [
  { codice: 'SIM0000001', etichetta: 'Tessera di test 1', descr: 'Open Mese valido' },
  { codice: 'SIM0000002', etichetta: 'Tessera di test 2', descr: 'Carnet, 3 ingressi' },
  { codice: 'SIM0000003', etichetta: 'Tessera di test 3', descr: 'Abbonamento scaduto' },
];
export const ALTRI_CASI = [
  { codice: 'SIM0000004', descr: 'Carnet esaurito' },
  { codice: 'SIM0000005', descr: 'Nessun abbonamento' },
  { codice: 'SIM0000006', descr: 'Scadenza + carnet (priorità)' },
  { codice: 'SIM0000007', descr: 'Scade tra 3 giorni' },
  { codice: 'SIM0000008', descr: 'Tessera disattivata' },
  { codice: 'SIM0000009', descr: 'Non ancora attivo' },
  { codice: 'SIMXXXXXXX', descr: 'Tessera sconosciuta' },
];

export function datiDemo(oggi = oggiRoma()) {
  const s = (id, nome, cognome) => ({ id, nome, cognome });
  const soci = [
    s('s1', 'Giulia', 'Bianchi'), s('s2', 'Marco', 'Rossi'), s('s3', 'Luca', 'Ferrari'),
    s('s4', 'Sara', 'Esposito'), s('s5', 'Andrea', 'Colombo'), s('s6', 'Chiara', 'Ricci'),
    s('s7', 'Matteo', 'Greco'), s('s8', 'Elena', 'Bruno'), s('s9', 'Davide', 'Gallo'),
  ];
  const a = (id, socio_id, tipo, piano, da, al, residuo = null) =>
    ({ id, socio_id, tipo, piano, data_inizio: piu(oggi, da), data_scadenza: piu(oggi, al), residuo });
  const abbonamenti = [
    a('a1', 's1', 'scadenza', 'Open Mese', -10, 20),
    a('a2', 's2', 'ingressi', 'Carnet 10 ingressi', -30, 60, 3),
    a('a3', 's3', 'scadenza', 'Trimestrale', -100, -9),
    a('a4', 's4', 'ingressi', 'Carnet 5 ingressi', -20, 40, 0),
    a('a6a', 's6', 'scadenza', 'Open Mese', -5, 25),
    a('a6b', 's6', 'ingressi', 'Carnet 10 ingressi', -5, 90, 7),
    a('a7', 's7', 'scadenza', 'Open Mese', -27, 3),
    a('a8', 's8', 'scadenza', 'Annuale', -100, 265),
    a('a9', 's9', 'scadenza', 'Open Mese', 4, 34),
  ];
  const tessere = soci.map((x, i) => ({
    id: `t${i + 1}`, codice: `SIM000000${i + 1}`, socio_id: x.id, attiva: x.id !== 's8',
  }));
  return { soci, abbonamenti, tessere };
}
