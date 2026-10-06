// Archivio LOCALE del terminale (IndexedDB): sopravvive a riavvii e chiusura del browser.
//   meta         snapshot (versione, ora di ricezione), varie
//   tessere      codice -> socio (solo tessere attive)
//   soci         solo id, nome, cognome
//   abbonamenti  tipo, piano, date, residuo (nessun prezzo)
//   coda         eventi registrati offline in attesa di sincronizzazione
// Usato solo da dataLayer.js e sync.js.

const NOME_DB = 'gymin-accessi';
const VERSIONE_DB = 1;
const STORE_DATI = ['tessere', 'soci', 'abbonamenti'];

const req = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });

export async function apriArchivio({ nome = NOME_DB, idb = globalThis.indexedDB } = {}) {
  if (!idb) throw new Error('IndexedDB non disponibile');
  const db = await new Promise((ok, ko) => {
    const r = idb.open(nome, VERSIONE_DB);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('meta', { keyPath: 'k' });
      d.createObjectStore('tessere', { keyPath: 'codice' });
      d.createObjectStore('soci', { keyPath: 'id' });
      d.createObjectStore('abbonamenti', { keyPath: 'id' }).createIndex('socio_id', 'socio_id');
      d.createObjectStore('coda', { keyPath: 'evento_id' }).createIndex('ts', 'ts');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });

  /** Esegue fn dentro UNA transazione; risolve al commit con il valore restituito da fn. */
  function tx(stores, modo, fn) {
    return new Promise((ok, ko) => {
      const t = db.transaction(stores, modo);
      const s = Object.fromEntries([stores].flat().map((n) => [n, t.objectStore(n)]));
      let valore;
      let errore = null;
      Promise.resolve().then(() => fn(s, t)).then((v) => { valore = v; }, (e) => { errore = e; try { t.abort(); } catch { /* già chiusa */ } });
      t.oncomplete = () => (errore ? ko(errore) : ok(valore));
      t.onerror = () => ko(errore || t.error);
      t.onabort = () => ko(errore || t.error || new Error('Transazione annullata'));
    });
  }

  // eventi offline: riapplica sul dato locale lo scalo degli ingressi non ancora sul server
  async function riapplicaCoda(s) {
    const eventi = await req(s.coda.getAll());
    for (const e of eventi) {
      const id = e.esito?.esito === 'ok' && e.esito?.tipo === 'ingressi' ? e.esito.abbonamento_id : null;
      if (!id) continue;
      const a = await req(s.abbonamenti.get(id));
      if (a && a.residuo != null) await req(s.abbonamenti.put({ ...a, residuo: Math.max(0, a.residuo - 1) }));
    }
  }

  return {
    chiudi: () => db.close(),

    getMeta: (k) => tx('meta', 'readonly', async (s) => (await req(s.meta.get(k)))?.v ?? null),
    setMeta: (k, v) => tx('meta', 'readwrite', (s) => req(s.meta.put({ k, v }))),

    /** Lettura offline atomica: legge i dati della tessera, decide con `decidi` (pura) e scrive esito + coda. */
    leggiEDecidi(codice, decidi) {
      return tx(['tessere', 'soci', 'abbonamenti', 'coda'], 'readwrite', async (s) => {
        const tessera = (await req(s.tessere.get(codice))) || null;
        const socio = tessera ? (await req(s.soci.get(tessera.socio_id))) || null : null;
        const abbonamenti = socio ? await req(s.abbonamenti.index('socio_id').getAll(socio.id)) : [];
        const { risultato, evento, scala } = decidi({ tessera, socio, abbonamenti });
        if (scala) {
          const a = abbonamenti.find((x) => x.id === scala);
          if (a) await req(s.abbonamenti.put({ ...a, residuo: Math.max(0, (a.residuo ?? 0) - 1) }));
        }
        if (evento) await req(s.coda.put(evento));
        return risultato;
      });
    },

    /** Dopo un esito ONLINE: allinea il residuo locale a quello del server. */
    impostaResiduo: (abbonamentoId, residuo) => tx('abbonamenti', 'readwrite', async (s) => {
      const a = await req(s.abbonamenti.get(abbonamentoId));
      if (a && residuo != null) await req(s.abbonamenti.put({ ...a, residuo }));
    }),

    /** Eventi in coda in ordine cronologico. */
    coda: () => tx('coda', 'readonly', (s) => req(s.coda.index('ts').getAll())),
    contaCoda: () => tx('coda', 'readonly', (s) => req(s.coda.count())),
    rimuoviDallaCoda: (ids) => tx('coda', 'readwrite', async (s) => { for (const id of ids) await req(s.coda.delete(id)); }),
    segnaTentativo: (ids, errore) => tx('coda', 'readwrite', async (s) => {
      for (const id of ids) {
        const e = await req(s.coda.get(id));
        if (e) await req(s.coda.put({ ...e, tentativi: (e.tentativi || 0) + 1, ultimo_errore: errore || null }));
      }
    }),

    /** Sostituisce la cache con lo snapshot del server e riapplica gli eventi ancora in coda. */
    applicaSnapshot: (snap, ricevutoIl = Date.now()) => tx([...STORE_DATI, 'coda', 'meta'], 'readwrite', async (s) => {
      for (const n of STORE_DATI) await req(s[n].clear());
      for (const t of snap.tessere || []) await req(s.tessere.put(t));
      for (const x of snap.soci || []) await req(s.soci.put(x));
      for (const a of snap.abbonamenti || []) await req(s.abbonamenti.put(a));
      await riapplicaCoda(s);
      await req(s.meta.put({ k: 'snapshot', v: { versione: snap.versione, ora_server: snap.ora_server, ricevuto_il: ricevutoIl,
        tessere: (snap.tessere || []).length, soci: (snap.soci || []).length, abbonamenti: (snap.abbonamenti || []).length } }));
    }),
  };
}
