// Lettore USB RFID in emulazione tastiera: "digita" il codice in pochi millisecondi e poi Invio
// (es. EM4100 125 kHz: 10 cifre come "0003827938" + Invio).
// Listener GLOBALE (funziona anche se il focus si perde) che accumula i caratteri arrivati
// a raffica e all'Invio consegna il codice. I tasti digitati lentamente a mano vengono ignorati.
import { normalizzaCodice } from './esito.js';

// Tra due tasti del lettore passano di solito 5-30 ms; a mano, anche veloci, ben più di 100.
// Configurabile con LETTORE_MAX_GAP_MS per lettori più lenti (vedi /gestione → Prova lettore).
export const MAX_GAP_MS = 100;
const TERMINATORI = new Set(['Enter', 'Tab']);   // alcuni lettori chiudono con Tab invece di Invio

/**
 * Logica pura (testabile): feed(tasto, istante) -> codice | null
 * ultimaRaffica() descrive l'ultima chiusura (accettata o no) per la diagnostica.
 * @param {{maxGapMs?: number}} opz
 */
export function creaAccumulatore({ maxGapMs = MAX_GAP_MS } = {}) {
  let buf = '';
  let ultimo = -Infinity;
  let inizio = 0;
  let gaps = [];
  let ultima = null;
  // traccia grezza per la diagnostica: tutti i caratteri dall'ultimo Invio, veloci o no
  let grezzo = '';
  let gapsGrezzi = [];
  let inizioGrezzo = 0;
  return {
    feed(key, t) {
      const gap = t - ultimo;
      const veloce = gap <= maxGapMs;
      ultimo = t;
      if (TERMINATORI.has(key)) {
        const codice = veloce ? normalizzaCodice(buf) : '';
        if (grezzo) {
          // accettato: misure della raffica; scartato: misure di tutto ciò che è arrivato
          const [testo, g, t0] = codice ? [buf, [...gaps, gap], inizio] : [grezzo, [...gapsGrezzi, gap], inizioGrezzo];
          ultima = {
            codice: normalizzaCodice(testo), accettato: !!codice, caratteri: testo.length,
            durataMs: Math.round(t - t0), gapMaxMs: Math.round(Math.max(...g)),
            gapMedioMs: Math.round(g.reduce((a, b) => a + b, 0) / g.length), sogliaMs: maxGapMs,
          };
        }
        buf = '';
        gaps = [];
        grezzo = '';
        gapsGrezzi = [];
        return codice || null;
      }
      if (typeof key !== 'string' || key.length !== 1) return null;
      if (grezzo) gapsGrezzi.push(gap); else inizioGrezzo = t;
      grezzo += key;
      // un carattere arrivato "lento" apre una nuova raffica
      if (veloce && buf) { buf += key; gaps.push(gap); } else { buf = key; gaps = []; inizio = t; }
      return null;
    },
    ultimaRaffica: () => ultima,
    reset() { buf = ''; gaps = []; grezzo = ''; gapsGrezzi = []; ultimo = -Infinity; },
  };
}

/**
 * Aggancia il lettore alla finestra.
 * @param {(codice: string) => void} onCodice
 * @param {{maxGapMs?: number, attivo?: () => boolean, onDiagnosi?: (info) => void}} opz
 *   attivo(): se restituisce false le battute vengono ignorate (es. /gestione fuori da "Passa la tessera")
 *   onDiagnosi(info): a ogni Invio/Tab dopo dei caratteri, anche se scartati perché troppo lenti
 * Gli elementi con attributo data-no-lettore (es. il campo della simulazione) sono esclusi.
 */
export function agganciaLettore(onCodice, { maxGapMs = MAX_GAP_MS, attivo = () => true, onDiagnosi = null, target = window } = {}) {
  const acc = creaAccumulatore({ maxGapMs: Number(maxGapMs) || MAX_GAP_MS });
  const h = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target?.closest?.('[data-no-lettore]')) return;
    if (!attivo()) { acc.reset(); return; }
    if (!TERMINATORI.has(e.key) && e.key.length !== 1) return;   // Shift & co. non interrompono la raffica
    e.preventDefault();                                           // mentre il lettore è attivo non si scrive altrove
    const prima = acc.ultimaRaffica();
    const codice = acc.feed(e.key, e.timeStamp || performance.now());
    const info = acc.ultimaRaffica();
    if (onDiagnosi && info && info !== prima) onDiagnosi(info);
    if (codice) onCodice(codice);
  };
  target.addEventListener('keydown', h, true);
  return () => target.removeEventListener('keydown', h, true);
}
