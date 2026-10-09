// APRIPORTA — comando del relè (Shelly) che sblocca la porta quando la tessera è valida.
// Nessun DOM: la schermata chiama apri() e mostra l'esito; testato in test/porta.test.js.
//
// Tipi:
//   ''      → spento (nessun comando)
//   'sim'   → simulato in memoria: nessuna rete, utile in ?demo=1 / ?sim=1
//   'shelly'→ HTTP locale verso lo Shelly (Gen2/Gen3/Gen4: RPC Switch.Set; Gen1: /relay/N)
//
// Il comando va in LAN, non via internet: la porta si apre anche col terminale OFFLINE.
// La richiesta è una GET "semplice" (niente header custom, niente preflight CORS).
// SHELLY_URL va indicato con l'IP (http://192.168.1.50), non con un nome DNS.

export const IMPULSO_S = 1;          // per quanti secondi il relè resta chiuso (serratura elettrica)
export const TIMEOUT_MS = 1500;      // oltre: comando considerato fallito (lo schermo non aspetta)

/** URL del comando di apertura per lo Shelly. */
export function urlApertura({ url, gen = 2, canale = 0, impulsoS = IMPULSO_S }) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error(`Indirizzo Shelly non valido: "${url}"`);
  const c = Number(canale) || 0;
  const s = Number(impulsoS) > 0 ? Number(impulsoS) : IMPULSO_S;
  return Number(gen) === 1
    ? `${base}/relay/${c}?turn=on&timer=${s}`
    : `${base}/rpc/Switch.Set?id=${c}&on=true&toggle_after=${s}`;
}

/**
 * Configurazione effettiva: l'indirizzo salvato sul PC (override) vince su quello del build.
 * @param {object} cfg  window.ACCESSI_CONFIG
 * @param {{shellyUrl?: string|null, sim?: boolean}} opz
 */
export function configPorta(cfg = {}, { shellyUrl = null, sim = false } = {}) {
  const url = shellyUrl || cfg.SHELLY_URL || '';
  let tipo = String(cfg.PORTA_TIPO || '').toLowerCase();
  if (url && !tipo) tipo = 'shelly';
  if (!url && tipo === 'shelly') tipo = '';
  if (!tipo && sim) tipo = 'sim';     // in simulazione si vede comunque il "comando" partire
  return {
    tipo,
    url,
    gen: Number(cfg.SHELLY_GEN) || 2,
    canale: Number(cfg.SHELLY_CANALE) || 0,
    impulsoS: Number(cfg.PORTA_IMPULSO_S) || IMPULSO_S,
    timeoutMs: Number(cfg.PORTA_TIMEOUT_MS) || TIMEOUT_MS,
  };
}

/**
 * @param {ReturnType<typeof configPorta>} cfg
 * @param {{fetch?: typeof fetch, ora?: () => number, onEsito?: (e) => void}} dip
 * apri() non lancia mai: restituisce {ok, tipo, ms, errore?, saltato?}.
 */
export function creaApriporta(cfg, { fetch: f = globalThis.fetch?.bind(globalThis), ora = () => Date.now(), onEsito = null } = {}) {
  const tipo = cfg?.tipo || '';
  let inCorso = null;
  let ultimo = null;

  async function esegui() {
    const t0 = ora();
    if (tipo === 'sim') return { ok: true, tipo, ms: 0, simulato: true };
    if (tipo !== 'shelly') return { ok: false, tipo, ms: 0, saltato: true };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || TIMEOUT_MS);
    try {
      const r = await f(urlApertura(cfg), {
        method: 'GET',
        signal: ctrl.signal,
        cache: 'no-store',
        // niente targetAddressSpace: se non corrisponde alla rete vera Chrome blocca la richiesta.
        // Con un IP della LAN (192.168.x.x) Chrome riconosce da solo la "rete locale" (vedi README).
      });
      if (!r.ok) return { ok: false, tipo, ms: ora() - t0, errore: `Shelly ha risposto HTTP ${r.status}` };
      return { ok: true, tipo, ms: ora() - t0 };
    } catch (e) {
      const errore = ctrl.signal.aborted ? `Shelly non risponde entro ${cfg.timeoutMs || TIMEOUT_MS} ms` : `Shelly non raggiungibile (${e.message})`;
      return { ok: false, tipo, ms: ora() - t0, errore };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    tipo,
    url: cfg?.url || '',
    attivo: tipo === 'sim' || tipo === 'shelly',
    get ultimo() { return ultimo; },
    /** Apre la porta. Due richieste ravvicinate condividono lo stesso comando (niente doppio impulso). */
    apri() {
      if (inCorso) return inCorso;
      inCorso = esegui().then((e) => {
        ultimo = { ...e, quando: ora() };
        try { onEsito?.(ultimo); } catch { /* la UI non deve rompere il comando */ }
        return ultimo;
      }).finally(() => { inCorso = null; });
      return inCorso;
    },
  };
}
