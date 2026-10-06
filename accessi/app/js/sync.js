// Sincronizzazione del terminale col server.
// A ogni giro (ogni 60 s se online, subito dopo la riconnessione, su richiesta dello staff):
//   1. invia la coda degli eventi offline in ordine cronologico, a lotti (terminale_sync, idempotente);
//      un evento esce dalla coda SOLO quando il server ne conferma la registrazione;
//   2. ricarica la cache locale dal server (terminale_snapshot; se invariata non riscrive nulla);
//   3. comunica lo stato del terminale (coda, cache, orologio) per /gestione.
// In caso di errore riprova con backoff esponenziale (5 s, 10 s, 20 s ... max 5 min).
import { ErroreAutorizzazione } from './dataLayer.js';

export const SOGLIA_OROLOGIO_MS = 3 * 60 * 1000;

export function creaSincronizzatore({
  terminale, archivio, intervalloMs = 60000, lotto = 50, ora = () => Date.now(),
  backoffBaseMs = 5000, backoffMaxMs = 300000, versioneApp = '', onCambio = () => {}, onNonAutorizzato = () => {},
}) {
  const { remoto, locale } = terminale;
  const stato = {
    inCorso: false, ultimaSync: null, ultimoTentativo: null, ultimoErrore: null, erroriConsecutivi: 0,
    inCoda: 0, cache: null, sfasamentoMs: 0, eventiConErrori: 0,
  };
  let timer = null;
  let fermo = true;
  let ancora = false;   // richiesta arrivata durante un giro in corso

  const registraOra = (oraServer) => { if (oraServer) stato.sfasamentoMs = ora() - Date.parse(oraServer); };
  const orologioSfasato = () => Math.abs(stato.sfasamentoMs) > SOGLIA_OROLOGIO_MS;

  async function aggiornaContatori() {
    if (!locale) return;
    stato.inCoda = await locale.contaCoda();
    stato.cache = await locale.infoCache();
  }

  async function inviaCoda() {
    const rifiutati = new Set();   // eventi rifiutati in questo giro: non bloccano quelli successivi
    for (;;) {
      const eventi = (await archivio.coda()).filter((e) => !rifiutati.has(e.evento_id)).slice(0, lotto);
      if (!eventi.length) break;
      const res = await remoto.sync(eventi.map(({ tentativi, ultimo_errore, ...e }) => e));
      registraOra(res.ora_server);
      const confermati = res.risultati.filter((x) => x.ok).map((x) => x.evento_id);
      const falliti = res.risultati.filter((x) => !x.ok);
      await archivio.rimuoviDallaCoda(confermati);
      if (falliti.length) await archivio.segnaTentativo(falliti.map((x) => x.evento_id), falliti[0].errore);
      for (const f of falliti) rifiutati.add(f.evento_id);
      // risposta incompleta: ci si riprova al prossimo giro
      if (!confermati.length && !falliti.length) break;
    }
    stato.eventiConErrori = rifiutati.size;
  }

  async function aggiornaCache() {
    const meta = await archivio.getMeta('snapshot');
    const s = await remoto.snapshot(meta?.versione ?? null);
    registraOra(s.ora_server);
    if (s.invariato) await archivio.setMeta('snapshot', { ...meta, ricevuto_il: ora(), ora_server: s.ora_server });
    else await archivio.applicaSnapshot(s, ora());
  }

  /** Un giro completo. Restituisce true se è andato a buon fine. */
  async function sincronizza() {
    if (stato.inCorso) { ancora = true; return false; }
    stato.inCorso = true;
    stato.ultimoTentativo = ora();
    onCambio(stato);
    let ok = false;
    let richiesta = false;
    try {
      if (terminale.forzaOffline) throw new Error('Offline (simulato)');
      if (archivio) {
        await inviaCoda();
        await aggiornaCache();
      }
      await aggiornaContatori();
      const r = await remoto.stato({
        in_coda: stato.inCoda,
        eventi_con_errori: stato.eventiConErrori,
        cache_versione: stato.cache?.versione ?? null,
        cache_ore: stato.cache ? Math.round(stato.cache.ore * 10) / 10 : null,
        cache_vecchia: !!stato.cache?.vecchia,
        sfasamento_ms: Math.round(stato.sfasamentoMs),
        orologio_sfasato: orologioSfasato(),
        versione_app: versioneApp,
        ora_terminale: new Date(ora()).toISOString(),
      });
      registraOra(r.ora_server);
      richiesta = !!r.sync_richiesta;
      terminale.segnaOnline();
      stato.ultimaSync = ora();
      stato.ultimoErrore = null;
      stato.erroriConsecutivi = 0;
      ok = true;
    } catch (e) {
      if (e instanceof ErroreAutorizzazione) onNonAutorizzato(e);
      if (!terminale.forzaOffline) terminale.segnaOffline();
      stato.ultimoErrore = e.message || String(e);
      stato.erroriConsecutivi += 1;
    } finally {
      try { await aggiornaContatori(); } catch { /* archivio non disponibile */ }
      stato.inCorso = false;
      onCambio(stato);
    }
    if (ancora || richiesta) { ancora = false; if (!fermo) pianifica(0); }
    else if (!fermo) pianifica(prossimoRitardo());
    return ok;
  }

  function prossimoRitardo() {
    if (!stato.erroriConsecutivi) return intervalloMs;
    return Math.min(backoffBaseMs * 2 ** (stato.erroriConsecutivi - 1), backoffMaxMs);
  }
  function pianifica(ms) {
    clearTimeout(timer);
    timer = setTimeout(sincronizza, ms);
  }

  const alRitornoOnline = () => { stato.erroriConsecutivi = 0; sincronizza(); };

  return {
    stato,
    orologioSfasato,
    prossimoRitardo,
    sincronizza,
    aggiornaContatori: () => aggiornaContatori().then(() => onCambio(stato)),
    avvia() {
      fermo = false;
      if (typeof window !== 'undefined') window.addEventListener('online', alRitornoOnline);
      return sincronizza();
    },
    ferma() {
      fermo = true;
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', alRitornoOnline);
    },
  };
}
