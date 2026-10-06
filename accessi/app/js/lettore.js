// Lettore USB RFID in emulazione tastiera: "digita" il codice in pochi millisecondi e poi Invio.
// Listener GLOBALE (funziona anche se il focus si perde) che accumula i caratteri arrivati
// a raffica e all'Invio consegna il codice. I tasti digitati lentamente a mano vengono ignorati.
import { normalizzaCodice } from './esito.js';

export const MAX_GAP_MS = 50;   // tra due tasti del lettore passano pochi ms; a mano ben più di 50

/**
 * Logica pura (testabile): feed(tasto, istante) -> codice | null
 * @param {{maxGapMs?: number}} opz
 */
export function creaAccumulatore({ maxGapMs = MAX_GAP_MS } = {}) {
  let buf = '';
  let ultimo = -Infinity;
  return {
    feed(key, t) {
      const veloce = t - ultimo <= maxGapMs;
      ultimo = t;
      if (key === 'Enter') {
        const codice = veloce ? normalizzaCodice(buf) : '';
        buf = '';
        return codice || null;
      }
      if (typeof key !== 'string' || key.length !== 1) return null;
      // un carattere arrivato "lento" apre una nuova raffica
      buf = veloce ? buf + key : key;
      return null;
    },
    reset() { buf = ''; ultimo = -Infinity; },
  };
}

/**
 * Aggancia il lettore alla finestra.
 * @param {(codice: string) => void} onCodice
 * @param {{maxGapMs?: number, attivo?: () => boolean}} opz
 *   attivo(): se restituisce false le battute vengono ignorate (es. /gestione fuori da "Passa la tessera")
 * Gli elementi con attributo data-no-lettore (es. il campo della simulazione) sono esclusi.
 */
export function agganciaLettore(onCodice, { maxGapMs = MAX_GAP_MS, attivo = () => true, target = window } = {}) {
  const acc = creaAccumulatore({ maxGapMs });
  const h = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target?.closest?.('[data-no-lettore]')) return;
    if (!attivo()) { acc.reset(); return; }
    if (e.key !== 'Enter' && e.key.length !== 1) return;   // Shift & co. non interrompono la raffica
    e.preventDefault();                                     // mentre il lettore è attivo non si scrive altrove
    const codice = acc.feed(e.key, e.timeStamp || performance.now());
    if (codice) onCodice(codice);
  };
  target.addEventListener('keydown', h, true);
  return () => target.removeEventListener('keydown', h, true);
}
