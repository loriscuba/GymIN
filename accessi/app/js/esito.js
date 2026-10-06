// REGOLE DEGLI ESITI — funzione di business PURA (nessun I/O, nessun DOM).
// Usata dalla modalità simulazione e dal fallback offline del terminale.
// La gemella lato database è accessi_decidi() in supabase/migrations/20261006120000_accessi_terminale.sql:
// i casi in test/casi-esito.json vengono verificati su ENTRAMBE, così le regole non divergono.
//
// Date: stringhe 'YYYY-MM-DD' (come le restituisce Postgres), giorno di calendario in Europe/Rome.

export const TZ = 'Europe/Rome';
export const SOGLIA_DOPPIA_MS = 5000;     // stessa tessera entro 5 s = doppia lettura
export const AVVISO_GIORNI = 7;           // avviso giallo se mancano meno di 7 giorni
export const AVVISO_INGRESSI = 2;         // ...o se restano 2 ingressi o meno

/** Codice tessera: stringa arbitraria, maiuscola, senza spazi. */
export function normalizzaCodice(s) {
  return String(s ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Data di oggi (o di `d`) in Europe/Rome come 'YYYY-MM-DD'. */
export function oggiRoma(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const giorno = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000;
/** a - b in giorni (date 'YYYY-MM-DD'). */
export const diffGiorni = (a, b) => giorno(a) - giorno(b);

/** gg/mm se nello stesso anno di `oggi`, altrimenti gg/mm/aaaa. */
export function fmtData(ymd, oggi) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return oggi && y === String(oggi).slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}
/** gg/mm/aaaa */
export const fmtDataCompleta = (ymd) => fmtData(ymd, null);

/** Istante (ISO) della mezzanotte di `ymd` a Roma: per i filtri per data. */
export function inizioGiornoRoma(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parti = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess));
  const v = (t) => +parti.find((p) => p.type === t).value;
  const offset = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute')) - guess;
  return new Date(guess - offset).toISOString();
}

const fmtDO = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** gg/mm/aaaa hh:mm in Europe/Rome */
export const fmtDataOra = (iso) => (iso ? fmtDO.format(new Date(iso)).replace(',', '') : '');

const valido = (a, oggi) =>
  a.data_inizio <= oggi && oggi <= a.data_scadenza && (a.tipo === 'scadenza' || (a.residuo ?? 0) > 0);

// ordine di priorità: 'scadenza' prima (non consuma nulla, quella che dura di più),
// poi 'ingressi' con la scadenza più vicina; a parità data_inizio e id
function confronta(a, b) {
  if (a.tipo !== b.tipo) return a.tipo === 'scadenza' ? -1 : 1;
  const ka = a.tipo === 'scadenza' ? -giorno(a.data_scadenza) : giorno(a.data_scadenza);
  const kb = b.tipo === 'scadenza' ? -giorno(b.data_scadenza) : giorno(b.data_scadenza);
  if (ka !== kb) return ka - kb;
  if (a.data_inizio !== b.data_inizio) return a.data_inizio < b.data_inizio ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/**
 * Decide l'esito sugli abbonamenti (non archiviati) di un socio.
 * @param {Array<{id, tipo:'scadenza'|'ingressi', piano, data_inizio, data_scadenza, residuo}>} abbonamenti
 * @param {string} oggi 'YYYY-MM-DD'
 */
export function decidiAbbonamenti(abbonamenti, oggi) {
  const abbs = abbonamenti || [];
  const validi = abbs.filter((a) => valido(a, oggi)).sort(confronta);
  if (validi.length) {
    const a = validi[0];
    const n = a.tipo === 'ingressi' ? (a.residuo ?? 0) : null;
    return {
      esito: 'ok', motivo_codice: null, motivo: null,
      abbonamento_id: a.id, tipo: a.tipo, piano: a.piano ?? null,
      data_scadenza: a.data_scadenza, giorni_rimasti: diffGiorni(a.data_scadenza, oggi),
      residuo_prima: n, residuo_dopo: n === null ? null : n - 1,
    };
  }
  if (!abbs.length) return { esito: 'negato', motivo_codice: 'nessun_abbonamento', motivo: 'Nessun abbonamento' };

  if (abbs.some((a) => a.tipo === 'ingressi' && a.data_inizio <= oggi && oggi <= a.data_scadenza && (a.residuo ?? 0) <= 0)) {
    return { esito: 'negato', motivo_codice: 'ingressi_esauriti', motivo: 'Ingressi esauriti' };
  }
  const futuri = abbs.filter((a) => a.data_inizio > oggi).map((a) => a.data_inizio).sort();
  if (futuri.length) {
    return { esito: 'negato', motivo_codice: 'non_ancora_attivo', motivo: `Abbonamento valido dal ${fmtData(futuri[0], oggi)}`, data_riferimento: futuri[0] };
  }
  const ultima = abbs.map((a) => a.data_scadenza).sort().at(-1);
  return { esito: 'negato', motivo_codice: 'scaduto', motivo: `Abbonamento scaduto il ${fmtData(ultima, oggi)}`, data_riferimento: ultima };
}

/**
 * Esito completo di una lettura.
 * @param {{tessera: {id, codice, socio_id, attiva}|null, socio: {id,nome,cognome}|null, abbonamenti: Array, oggi: string}} p
 */
export function decidiAccesso({ tessera, socio = null, abbonamenti = [], oggi }) {
  if (!tessera || tessera.attiva === false) {
    return { esito: 'negato', motivo_codice: 'tessera_sconosciuta', motivo: 'Tessera sconosciuta', socio: null };
  }
  return { ...decidiAbbonamenti(abbonamenti, oggi), socio };
}

/** Riga gialla di avviso per un esito verde (null se non serve). Vale anche per gli esiti del server. */
export function avviso(r) {
  if (!r || r.esito !== 'ok') return null;
  const parti = [];
  if (r.tipo === 'ingressi' && r.residuo_dopo != null && r.residuo_dopo <= AVVISO_INGRESSI) {
    parti.push(r.residuo_dopo <= 0 ? 'Ultimo ingresso del carnet' : r.residuo_dopo === 1 ? 'Resta 1 ingresso' : `Restano ${r.residuo_dopo} ingressi`);
  }
  const g = r.giorni_rimasti;
  if (g != null && g < AVVISO_GIORNI) {
    parti.push(g <= 0 ? 'Scade oggi' : g === 1 ? 'Scade domani' : `Scade tra ${g} giorni`);
  }
  return parti.length ? parti.join(' · ') : null;
}

/**
 * Filtro doppie letture, locale al terminale: la stessa tessera letta entro `ms`
 * dall'ultima lettura ELABORATA viene ignorata (niente secondo ingresso scalato).
 */
export function creaFiltroDoppie(ms = SOGLIA_DOPPIA_MS) {
  const ultime = new Map();
  return {
    /** true = doppia (da ignorare); false = da elaborare (e la registra) */
    controlla(codice, ora = Date.now()) {
      const t = ultime.get(codice);
      if (t !== undefined && ora - t >= 0 && ora - t < ms) return true;
      ultime.set(codice, ora);
      for (const [k, v] of ultime) if (ora - v >= ms) ultime.delete(k);
      return false;
    },
  };
}
