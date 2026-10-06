// UNICO punto di accesso ai dati del sotto-progetto Accessi.
//
// Terminale (/ingresso) — ONLINE-FIRST con FALLBACK LOCALE (il server è la fonte di verità):
//   - sorgente REMOTA: funzioni RPC del database via fetch (chiave anon + token del terminale);
//   - sorgente LOCALE: cache IndexedDB + coda eventi offline (archivio.js), decisa con la
//     STESSA funzione pura di esito.js;
//   - sorgente DEMO: un finto "server" in memoria per la simulazione (?demo=1);
//   - creaTerminale(): prova online entro ~2 s, altrimenti decide in locale con lo STESSO evento_id.
// Gestione (/gestione): client Supabase con la sessione staff di GymIN.
import { decidiAccesso, decidiAbbonamenti, normalizzaCodice, oggiRoma } from './esito.js';
import { datiDemo } from './demo.js';

export class ErroreRete extends Error {
  constructor(tipo, msg) { super(msg || (tipo === 'timeout' ? 'Il server non risponde' : 'Connessione assente')); this.tipo = tipo; }
}
export class ErroreAutorizzazione extends Error {}
export class ErroreServer extends Error {}
export class ErroreNonSincronizzato extends Error {
  constructor() { super('Terminale non ancora sincronizzato'); }
}

/** Campi dell'esito che il terminale offline invia al server insieme all'evento */
const esitoPerCoda = (r, socio) => ({
  esito: r.esito, motivo_codice: r.motivo_codice ?? null, motivo: r.motivo ?? null, socio_id: socio?.id ?? null,
  abbonamento_id: r.abbonamento_id ?? null, tipo: r.tipo ?? null, piano: r.piano ?? null, data_scadenza: r.data_scadenza ?? null,
  residuo_prima: r.residuo_prima ?? null, residuo_dopo: r.residuo_dopo ?? null,
});

// ---------------------------------------------------------------------------
// TERMINALE · sorgente remota
// ---------------------------------------------------------------------------
export function creaSorgenteRemota({ url, anonKey, schema = '', token, timeoutMs = 2000, fetchFn = (...a) => fetch(...a) }) {
  const base = String(url).replace(/\/+$/, '');
  async function rpc(nome, args, attesaMs = timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), attesaMs);
    let res, testo;
    try {
      res = await fetchFn(`${base}/rest/v1/rpc/${nome}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          ...(schema ? { 'Content-Profile': schema, 'Accept-Profile': schema } : {}),
        },
        body: JSON.stringify(args),
        signal: ctrl.signal,
      });
      testo = await res.text();
    } catch (e) {
      throw new ErroreRete(ctrl.signal.aborted ? 'timeout' : 'rete');
    } finally {
      clearTimeout(timer);
    }
    let corpo = null;
    try { corpo = testo ? JSON.parse(testo) : null; } catch { /* risposta non JSON */ }
    if (!res.ok) {
      const msg = corpo?.message || `Errore del server (${res.status})`;
      if (corpo?.code === '28000') throw new ErroreAutorizzazione(msg);
      if (res.status >= 500 || res.status === 0) throw new ErroreRete('server', msg);
      throw new ErroreServer(msg);
    }
    return corpo;
  }
  return {
    tipo: 'remoto',
    ping: () => rpc('terminale_ping', { p_token: token }),
    /** Lettura online: valuta + scala + registra in un'unica funzione atomica lato database. */
    registraLettura: ({ codice, evento_id, ts, doppia = false }) =>
      rpc('terminale_accesso', { p_token: token, p_codice: codice, p_evento_id: evento_id, p_ts_terminale: ts, p_doppia: doppia }),
    snapshot: (versione = null) => rpc('terminale_snapshot', { p_token: token, p_versione: versione }, Math.max(timeoutMs, 15000)),
    sync: (eventi) => rpc('terminale_sync', { p_token: token, p_eventi: eventi }, Math.max(timeoutMs, 20000)),
    stato: (stato) => rpc('terminale_stato', { p_token: token, p_stato: stato }, Math.max(timeoutMs, 5000)),
  };
}

// ---------------------------------------------------------------------------
// TERMINALE · sorgente locale (cache IndexedDB + coda eventi)
// ---------------------------------------------------------------------------
export function creaSorgenteLocale(archivio, { cacheMaxOre = 72, ora = () => Date.now() } = {}) {
  const loc = {
    tipo: 'locale',
    archivio,
    /** null se il terminale non ha mai sincronizzato */
    async infoCache() {
      const s = await archivio.getMeta('snapshot');
      if (!s) return null;
      const ore = Math.max(0, (ora() - s.ricevuto_il) / 3600000);
      return { ...s, ore, vecchia: ore > cacheMaxOre };
    },
    contaCoda: () => archivio.contaCoda(),
    impostaResiduo: (id, residuo) => archivio.impostaResiduo(id, residuo),
    /** Lettura OFFLINE: stessa funzione di business sui dati locali; se verde a ingressi scala il residuo locale. */
    async registraLettura({ codice, evento_id, ts, doppia = false }) {
      const cache = await loc.infoCache();
      if (!cache) throw new ErroreNonSincronizzato();
      const c = normalizzaCodice(codice);
      const nota = cache.vecchia ? `Dati locali non aggiornati da ${Math.floor(cache.ore)} ore` : '';
      return archivio.leggiEDecidi(c, ({ tessera, socio, abbonamenti }) => {
        const r = doppia
          ? { esito: 'doppia_lettura', motivo: 'Lettura ripetuta ignorata', socio }
          : decidiAccesso({ tessera, socio, abbonamenti, oggi: oggiRoma(new Date(ts)) });
        const evento = { evento_id, codice: c, ts, doppia, esito: esitoPerCoda(r, socio), nota, tentativi: 0 };
        return {
          risultato: { ...r, socio, evento_id, codice: c, ts_terminale: ts, offline: true, da_verificare: false, duplicato: false, cache_vecchia: cache.vecchia },
          evento,
          scala: r.esito === 'ok' && r.tipo === 'ingressi' ? r.abbonamento_id : null,
        };
      });
    },
  };
  return loc;
}

// ---------------------------------------------------------------------------
// TERMINALE · sorgente demo: finto server in memoria con le stesse regole del DB
// (accessi_esegui: idempotenza su evento_id, conflitti offline "da verificare", residuo mai < 0)
// ---------------------------------------------------------------------------
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };

export function creaSorgenteDemo(dati = datiDemo(), { ritardoMs = 0 } = {}) {
  const log = [];
  const attendi = () => (ritardoMs ? new Promise((r) => setTimeout(r, ritardoMs)) : Promise.resolve());
  const oraServer = () => new Date().toISOString();

  function esegui({ codice, evento_id, ts, doppia = false, offline = false, esitoTerminale = null }) {
    const c = normalizzaCodice(codice);
    const gia = log.find((l) => l.evento_id === evento_id);
    if (gia) return { ...gia, duplicato: true, ora_server: oraServer() };
    const tessera = dati.tessere.find((t) => t.codice === c && t.attiva) || null;
    let socio = tessera ? dati.soci.find((s) => s.id === tessera.socio_id) || null : null;
    const oggi = oggiRoma(offline && ts ? new Date(ts) : new Date());
    let r;
    let verifica = false;
    if (doppia) {
      r = { esito: 'doppia_lettura', motivo: 'Lettura ripetuta ignorata', socio };
    } else {
      r = decidiAccesso({ tessera, socio, oggi, abbonamenti: socio ? dati.abbonamenti.filter((a) => a.socio_id === socio.id) : [] });
      const et = offline ? esitoTerminale : null;
      if (et?.esito === 'ok' && r.esito !== 'ok') {
        verifica = true;
        socio = socio || dati.soci.find((s) => s.id === et.socio_id) || null;
        r = { esito: 'ok', motivo_codice: r.motivo_codice, motivo: r.motivo, socio, abbonamento_id: et.abbonamento_id, tipo: et.tipo,
          piano: et.piano, data_scadenza: et.data_scadenza, giorni_rimasti: null, residuo_prima: null, residuo_dopo: null };
      } else if (et?.esito === 'negato') {
        r = { esito: 'negato', motivo_codice: et.motivo_codice, motivo: et.motivo, socio };
      }
      if (r.esito === 'ok' && !verifica && r.tipo === 'ingressi') {
        const a = dati.abbonamenti.find((x) => x.id === r.abbonamento_id);
        if (a && a.residuo > 0) a.residuo -= 1;
      }
    }
    const out = { ...r, log_id: log.length + 1, evento_id, codice: c, ts_terminale: ts, ora_server: oraServer(),
      offline, da_verificare: verifica, duplicato: false };
    log.push(out);
    return out;
  }

  return {
    tipo: 'demo',
    dati,
    log,
    async ping() { await attendi(); return { nome: 'Simulazione (dati demo)', ora_server: oraServer() }; },
    async registraLettura(p) { await attendi(); return esegui(p); },
    async snapshot(versione = null) {
      await attendi();
      const tessere = dati.tessere.filter((t) => t.attiva).map(({ codice, socio_id }) => ({ codice, socio_id }));
      const ids = new Set(tessere.map((t) => t.socio_id));
      const snap = {
        tessere,
        soci: dati.soci.filter((s) => ids.has(s.id)).map(({ id, nome, cognome }) => ({ id, nome, cognome })),
        abbonamenti: dati.abbonamenti.filter((a) => ids.has(a.socio_id)).map((a) => ({ ...a })),
      };
      const v = hash(JSON.stringify(snap) + oggiRoma());
      if (versione === v) return { invariato: true, versione: v, ora_server: oraServer() };
      return { ...snap, invariato: false, versione: v, ora_server: oraServer() };
    },
    async sync(eventi) {
      await attendi();
      const ordinati = [...eventi].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      return {
        ora_server: oraServer(),
        risultati: ordinati.map((e) => {
          const r = esegui({ ...e, offline: true, esitoTerminale: e.esito });
          return { evento_id: e.evento_id, ok: true, esito: r.esito, da_verificare: r.da_verificare, duplicato: r.duplicato };
        }),
      };
    },
    async stato(s) { await attendi(); this.ultimoStato = s; return { ora_server: oraServer(), nome: 'Simulazione (dati demo)', sync_richiesta: false }; },
  };
}

// ---------------------------------------------------------------------------
// TERMINALE · orchestratore online-first con fallback locale
// ---------------------------------------------------------------------------
/**
 * @param {{remoto: object, locale?: object|null, ora?: () => number, pausaDopoErroreMs?: number}} p
 * Dopo un errore di rete le letture vanno direttamente in locale per `pausaDopoErroreMs`
 * (niente attese di 2 s a ogni tessera); il sincronizzatore riporta online appena il server risponde.
 */
export function creaTerminale({ remoto, locale = null, ora = () => Date.now(), pausaDopoErroreMs = 30000 }) {
  let forzaOffline = false;
  let offlineFino = 0;
  let online = null;
  const t = {
    tipo: remoto.tipo,
    remoto,
    locale,
    get online() { return forzaOffline ? false : online; },
    get forzaOffline() { return forzaOffline; },
    set forzaOffline(v) { forzaOffline = !!v; },
    /** true se ora le letture vanno in locale senza tentare il server */
    offlineAttivo: () => forzaOffline || ora() < offlineFino || (typeof navigator !== 'undefined' && navigator.onLine === false),
    segnaOnline() { online = true; offlineFino = 0; },
    segnaOffline() { online = false; offlineFino = ora() + pausaDopoErroreMs; },
    ping: () => (forzaOffline ? Promise.reject(new ErroreRete('rete')) : remoto.ping()),

    /** Lettura: online entro il timeout, altrimenti fallback locale con lo STESSO evento_id. */
    async registraLettura(p) {
      if (!t.offlineAttivo()) {
        try {
          const r = await remoto.registraLettura(p);
          online = true;
          if (locale && r.esito === 'ok' && r.tipo === 'ingressi' && r.abbonamento_id && r.residuo_dopo != null) {
            locale.impostaResiduo(r.abbonamento_id, r.residuo_dopo).catch(() => {});
          }
          return r;
        } catch (e) {
          if (e instanceof ErroreAutorizzazione) throw e;
          t.segnaOffline();
        }
      } else {
        online = false;
      }
      if (!locale) throw new ErroreRete('rete');
      return locale.registraLettura(p);
    },
  };
  return t;
}

/**
 * Sceglie le sorgenti del terminale.
 * - ?demo=1                       -> server demo in memoria (+ cache locale se c'è l'archivio)
 * - Supabase configurato + token  -> remota (+ cache locale)
 * - Supabase NON configurato + ?sim=1 -> demo
 * - altrimenti null (serve la configurazione del terminale)
 */
export function creaDataLayerTerminale({ config = {}, token = null, sim = false, demo = false, archivio = null } = {}) {
  const remotoOk = !!(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  let remoto = null;
  if (demo || (!remotoOk && sim)) remoto = creaSorgenteDemo();
  else if (remotoOk && token) {
    remoto = creaSorgenteRemota({ url: config.SUPABASE_URL, anonKey: config.SUPABASE_ANON_KEY, schema: config.DB_SCHEMA,
      token, timeoutMs: config.TIMEOUT_ONLINE_MS || 2000 });
  }
  if (!remoto) return null;
  const locale = archivio ? creaSorgenteLocale(archivio, { cacheMaxOre: config.CACHE_MAX_ORE || 72 }) : null;
  return creaTerminale({ remoto, locale });
}
export const remotoConfigurato = (config = {}) => !!(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// GESTIONE (staff autenticato, sessione Supabase condivisa con GymIN)
// ---------------------------------------------------------------------------
export async function creaClientSupabase(config = {}) {
  if (!remotoConfigurato(config)) return null;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, config.DB_SCHEMA ? { db: { schema: config.DB_SCHEMA } } : undefined);
}

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// PostgREST restituisce al massimo 1000 righe per richiesta: pagina fino alla fine
async function tutte(crea, passo = 1000) {
  const out = [];
  for (let da = 0; ; da += passo) {
    const righe = ok(await crea().range(da, da + passo - 1));
    out.push(...righe);
    if (righe.length < passo) return out;
  }
}

/** Abbonamento di GymIN -> formato delle regole (esito.js / accessi_decidi) */
export const abbonamentoPerRegole = (a) => {
  const carnet = (a.piano?.entrate || 0) > 0;
  return { id: a.id, socio_id: a.socio_id, tipo: carnet ? 'ingressi' : 'scadenza', piano: a.piano?.nome ?? null,
    data_inizio: a.data_inizio, data_scadenza: a.data_scadenza, residuo: carnet ? (a.entrate_residue ?? 0) : null };
};

export function creaDataLayerGestione(supa) {
  const rpc = async (nome, args) => ok(await supa.rpc(nome, args));
  return {
    supa,
    sessione: async () => ok(await supa.auth.getSession())?.session ?? null,
    accedi: async (email, password) => ok(await supa.auth.signInWithPassword({ email, password })),
    esci: () => supa.auth.signOut(),

    soci: () => tutte(() => supa.from('soci').select('id,nome,cognome,tessera').order('cognome').order('nome')),
    tessere: () => tutte(() => supa.from('tessere').select('*').order('creato_il', { ascending: false })),

    /** Soci con un abbonamento valido oggi e nessuna tessera attiva (per l'associazione rapida) */
    async sociValidiSenzaTessera(soci, tessere) {
      const oggi = oggiRoma();
      const abbs = await tutte(() => supa.from('abbonamenti')
        .select('id,socio_id,data_inizio,data_scadenza,entrate_residue,stato,piano:piani(nome,entrate)')
        .gte('data_scadenza', oggi).neq('stato', 'archiviato'));
      const conTessera = new Set(tessere.filter((t) => t.attiva).map((t) => t.socio_id));
      const perSocio = new Map();
      for (const a of abbs) perSocio.set(a.socio_id, [...(perSocio.get(a.socio_id) || []), abbonamentoPerRegole(a)]);
      return soci
        .filter((s) => !conTessera.has(s.id) && perSocio.has(s.id))
        .map((s) => ({ ...s, esito: decidiAbbonamenti(perSocio.get(s.id), oggi) }))
        .filter((s) => s.esito.esito === 'ok');
    },

    assegnaTessera: (socioId, codice, modo = 'aggiungi', conferma = false) =>
      rpc('staff_assegna_tessera', { p_socio_id: socioId, p_codice: codice, p_modo: modo, p_conferma: conferma }),
    disattivaTessera: (id, motivo) => rpc('staff_disattiva_tessera', { p_tessera_id: id, p_motivo: motivo }),
    tessereNonAssociate: () => rpc('staff_tessere_non_associate', {}),

    ultimiIngressi: async (n = 30) => ok(await supa.from('accessi_log')
      .select('*, socio:soci(nome,cognome)')
      .eq('esito', 'ok').is('annullato_il', null)
      .order('ts_server', { ascending: false }).limit(n)),
    annullaIngresso: (logId, motivo) => rpc('staff_annulla_ingresso', { p_log_id: logId, p_motivo: motivo }),

    /** filtri: { socioIds?: string[], dal?: ISO, al?: ISO, esito?: string, offline?: 'si'|'no' } */
    async storico(f = {}, limite = 500) {
      let q = supa.from('accessi_log').select('*, socio:soci(nome,cognome), terminale:terminali(nome)');
      if (f.socioIds) q = q.in('socio_id', f.socioIds.length ? f.socioIds : ['00000000-0000-0000-0000-000000000000']);
      if (f.dal) q = q.gte('ts_server', f.dal);
      if (f.al) q = q.lt('ts_server', f.al);
      if (f.esito) q = q.eq('esito', f.esito);
      if (f.offline === 'si') q = q.eq('offline', true);
      if (f.offline === 'no') q = q.eq('offline', false);
      return ok(await q.order('ts_server', { ascending: false }).limit(limite));
    },
    daVerificare: async () => ok(await supa.from('accessi_log')
      .select('*, socio:soci(nome,cognome), terminale:terminali(nome)')
      .eq('da_verificare', true).is('verificato_il', null)
      .order('ts_terminale', { ascending: false })),
    segnaVerificato: (logId, nota) => rpc('staff_segna_verificato', { p_log_id: logId, p_nota: nota }),

    terminali: async () => ok(await supa.from('terminali')
      .select('id,nome,attivo,creato_il,ultimo_contatto,ultima_sync,stato,sync_richiesta_il').order('creato_il')),
    creaTerminale: (nome) => rpc('staff_crea_terminale', { p_nome: nome }),
    revocaTerminale: (id) => rpc('staff_revoca_terminale', { p_id: id }),
    /** "Sincronizza ora": il terminale lo riceve al prossimo contatto col server (entro ~1 minuto) */
    richiediSync: (id) => rpc('staff_richiedi_sync', { p_id: id }),
  };
}
