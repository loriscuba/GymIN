// UNICO punto di accesso ai dati del sotto-progetto Accessi.
//
// Terminale (/ingresso):
//   - sorgente REMOTA: funzioni RPC del database via fetch (chiave anon + token del terminale);
//   - sorgente DEMO: dati in memoria per la simulazione, decisi con la funzione pura di esito.js.
//   (In fase 2 si aggiunge la sorgente LOCALE: cache IndexedDB + coda eventi offline.)
// Gestione (/gestione): client Supabase con la sessione staff di GymIN.
import { decidiAccesso, decidiAbbonamenti, normalizzaCodice, oggiRoma } from './esito.js';
import { datiDemo } from './demo.js';

export class ErroreRete extends Error {
  constructor(tipo, msg) { super(msg || (tipo === 'timeout' ? 'Il server non risponde' : 'Connessione assente')); this.tipo = tipo; }
}
export class ErroreAutorizzazione extends Error {}
export class ErroreServer extends Error {}

// ---------------------------------------------------------------------------
// TERMINALE · sorgente remota
// ---------------------------------------------------------------------------
export function creaSorgenteRemota({ url, anonKey, schema = '', token, timeoutMs = 2000, fetchFn = (...a) => fetch(...a) }) {
  const base = String(url).replace(/\/+$/, '');
  async function rpc(nome, args) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
  };
}

// ---------------------------------------------------------------------------
// TERMINALE · sorgente demo (simulazione senza database)
// ---------------------------------------------------------------------------
export function creaSorgenteDemo(dati = datiDemo()) {
  const log = [];
  return {
    tipo: 'demo',
    dati,
    log,
    async ping() { return { nome: 'Simulazione (dati demo)', ora_server: new Date().toISOString() }; },
    async registraLettura({ codice, evento_id, ts, doppia = false }) {
      const c = normalizzaCodice(codice);
      const gia = log.find((l) => l.evento_id === evento_id);
      if (gia) return { ...gia, duplicato: true };
      const tessera = dati.tessere.find((t) => t.codice === c && t.attiva) || null;
      const socio = tessera ? dati.soci.find((s) => s.id === tessera.socio_id) || null : null;
      let r;
      if (doppia) {
        r = { esito: 'doppia_lettura', motivo: 'Lettura ripetuta ignorata', socio };
      } else {
        r = decidiAccesso({
          tessera, socio, oggi: oggiRoma(ts ? new Date(ts) : new Date()),
          abbonamenti: socio ? dati.abbonamenti.filter((a) => a.socio_id === socio.id) : [],
        });
        if (r.esito === 'ok' && r.tipo === 'ingressi') dati.abbonamenti.find((a) => a.id === r.abbonamento_id).residuo -= 1;
      }
      const out = { ...r, log_id: log.length + 1, evento_id, codice: c, ts_terminale: ts, ora_server: new Date().toISOString(),
        offline: false, da_verificare: false, duplicato: false };
      log.push(out);
      return out;
    },
  };
}

/**
 * Sceglie la sorgente del terminale.
 * - ?demo=1                       -> demo in memoria (mai il database)
 * - Supabase configurato + token  -> remota
 * - Supabase NON configurato + ?sim=1 -> demo in memoria
 * - altrimenti null (serve la configurazione del terminale)
 */
export function creaDataLayerTerminale({ config = {}, token = null, sim = false, demo = false } = {}) {
  if (demo) return creaSorgenteDemo();   // ?demo=1: dati in memoria anche se il DB è configurato
  const remoto = !!(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  if (remoto && token) {
    return creaSorgenteRemota({ url: config.SUPABASE_URL, anonKey: config.SUPABASE_ANON_KEY, schema: config.DB_SCHEMA,
      token, timeoutMs: config.TIMEOUT_ONLINE_MS || 2000 });
  }
  if (!remoto && sim) return creaSorgenteDemo();
  return null;
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
      .select('id,nome,attivo,creato_il,ultimo_contatto,ultima_sync').order('creato_il')),
    creaTerminale: (nome) => rpc('staff_crea_terminale', { p_nome: nome }),
    revocaTerminale: (id) => rpc('staff_revoca_terminale', { p_id: id }),
  };
}
