// Schermata kiosk /ingresso — online-first con fallback locale (fase 2)
import { avviso, creaFiltroDoppie, fmtDataCompleta, TZ } from './esito.js';
import { agganciaLettore } from './lettore.js';
import { sbloccaAudio, suona } from './suoni.js';
import { creaDataLayerTerminale, remotoConfigurato, ErroreAutorizzazione, ErroreNonSincronizzato } from './dataLayer.js';
import { apriArchivio } from './archivio.js';
import { creaSincronizzatore, SOGLIA_OROLOGIO_MS } from './sync.js';
import { TESSERE_TEST, ALTRI_CASI } from './demo.js';
import { scaricaMeteo } from './meteo.js';
import { configPorta, creaApriporta } from './porta.js';

const CFG = window.ACCESSI_CONFIG || {};
const DURATA_ESITO = CFG.DURATA_ESITO_MS || 3000;
const RITARDO_SUONI = CFG.RITARDO_SUONI_MS ?? 150;
const VERSIONE_APP = '__BUILD__';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';                 // simulazione con dati in memoria, mai il database
const SIM = params.get('sim') === '1' || DEMO;

// Produzione e test stanno sullo stesso dominio: token e cache separati per schema
const SPAZIO = DEMO ? 'demo' : (CFG.DB_SCHEMA || 'public');
const CHIAVE_TOKEN = `gymin.accessi.token${SPAZIO === 'public' ? '' : `.${SPAZIO}`}`;
const NOME_DB = `gymin-accessi-${SPAZIO}`;
const CHIAVE_NOME = `gymin.accessi.nome.${SPAZIO}`;
const CHIAVE_SHELLY = `gymin.accessi.shelly.${SPAZIO}`;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage non disponibile */ } },
};

// token passato una volta via URL (?token=...) -> salvato e tolto dall'indirizzo
if (params.get('token')) {
  store.set(CHIAVE_TOKEN, params.get('token').trim());
  params.delete('token');
  history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''));
}

// indirizzo dello Shelly di QUESTO PC, passato una volta via URL (?shelly=http://192.168.1.50, ?shelly=off per toglierlo)
if (params.has('shelly')) {
  const v = params.get('shelly').trim();
  store.set(CHIAVE_SHELLY, !v || v === 'off' ? null : v);
  params.delete('shelly');
  history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''));
}
const porta = creaApriporta(configPorta(CFG, { shellyUrl: store.get(CHIAVE_SHELLY), sim: SIM }), {
  onEsito: (e) => {
    if (!e.ok && !e.saltato) console.warn('Apertura porta non riuscita:', e.errore);
    aggiornaPannelloSim();
  },
});

let data = null;          // terminale (dataLayer: remoto + locale)
let sync = null;          // sincronizzatore
let archivio = null;
let nomeTerminale = store.get(CHIAVE_NOME) || '';   // ricordato per i riavvii offline
let vista = 'attesa';
let timerEsito = null;
let ricaricaQuandoLibero = false;
const filtroDoppie = creaFiltroDoppie();

// ---------------------------------------------------------------------------
// PWA: service worker + storage persistente
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const avevaController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('../sw.js', { scope: '../' })
    .then((reg) => setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000))   // il kiosk non naviga mai: controlla gli aggiornamenti ogni ora
    .catch((e) => console.warn('Service worker non registrato:', e));
  // nuova versione pubblicata: ricarica appena la schermata è in attesa
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avevaController) return;
    ricaricaQuandoLibero = true;
    if (vista === 'attesa' || vista === 'nonsync') location.reload();
  });
}
navigator.storage?.persist?.().then((ok) => { if (!ok) console.warn('Storage persistente non concesso dal browser'); }).catch(() => {});

// ---------------------------------------------------------------------------
// orologio, bande e barra di stato
// ---------------------------------------------------------------------------
const fmtOra = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtGiorno = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function tick() {
  const d = new Date();
  $('#orologio').textContent = fmtOra.format(d);
  $('#data').textContent = fmtGiorno.format(d);
}
setInterval(tick, 1000);
tick();

// meteo di oggi (facoltativo: senza rete o con METEO_LAT vuoto il riquadro resta nascosto)
async function aggiornaMeteo() {
  if (!CFG.METEO_LAT || !CFG.METEO_LON) return;
  try {
    const m = await scaricaMeteo(CFG.METEO_LAT, CFG.METEO_LON);
    if (!m) return;
    const minmax = m.min != null && m.max != null ? `min ${m.min}° · max ${m.max}°` : '';
    const pioggia = m.pioggia ? ` · pioggia ${m.pioggia}%` : '';
    $('#meteo').innerHTML = `<span class="m-icona">${m.icona}</span><span class="m-temp">${m.temp}°</span>`
      + `<span class="m-testo">${esc(m.testo)}</span>`
      + `<span class="m-dett">${CFG.METEO_LUOGO ? `${esc(CFG.METEO_LUOGO)} · ` : ''}${minmax}${pioggia}</span>`;
    $('#meteo').hidden = false;
  } catch (e) {
    console.warn('Meteo non disponibile:', e.message);   // resta l'ultimo valore mostrato (o nascosto)
  }
}
aggiornaMeteo();
setInterval(aggiornaMeteo, 30 * 60 * 1000);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// logo: se l'immagine non si carica si nasconde il riquadro (al posto di onerror inline, bloccato dalla CSP)
{
  const img = document.querySelector('.logo-box img');
  const ko = () => { img.parentNode.hidden = true; };
  if (img) { if (img.complete && !img.naturalWidth) ko(); else img.addEventListener('error', ko); }
}
const offline = () => !!data && data.online === false;
const inCoda = () => sync?.stato.inCoda || 0;
const accessiDaSync = (n) => `${n} ${n === 1 ? 'accesso' : 'accessi'} da sincronizzare`;

function aggiornaStato() {
  const cache = sync?.stato.cache;
  // banda OFFLINE solo in attesa; sull'esito c'è il badge
  const bandaOff = $('#banda-offline');
  bandaOff.hidden = !(offline() && vista === 'attesa');
  bandaOff.textContent = `OFFLINE – ${accessiDaSync(inCoda())}`;
  const bandaCache = $('#banda-cache');
  bandaCache.hidden = !(cache?.vecchia && vista !== 'setup');
  if (cache?.vecchia) bandaCache.textContent = `Dati non aggiornati da ${Math.floor(cache.ore)} ore`;

  const sx = [];
  if (data?.tipo === 'demo') sx.push('<span class="badge">SIMULAZIONE · dati demo</span>');
  else if (nomeTerminale) sx.push(esc(nomeTerminale));
  if (SIM && data?.tipo !== 'demo') sx.push('<span class="badge">SIM</span>');
  $('#b-sx').innerHTML = sx.join(' ');

  const dx = [];
  const sfas = sync?.stato.sfasamentoMs || 0;
  if (Math.abs(sfas) > SOGLIA_OROLOGIO_MS) dx.push(`<span class="giallo">Orologio del PC sfasato di ${Math.round(Math.abs(sfas) / 60000)} min</span>`);
  if (data && data.online !== null) {
    const n = inCoda();
    dx.push(`<span class="punto${data.online ? '' : ' off'}"></span>${data.online ? (n ? `Online · invio ${accessiDaSync(n)}` : 'Online') : 'Offline'}`);
  }
  $('#b-dx').innerHTML = dx.join(' &nbsp; ');

  // mai sincronizzato e senza rete: schermata dedicata al posto dell'attesa
  if ((vista === 'attesa' || vista === 'nonsync') && data && archivio) {
    const serveNonSync = !cache && data.online === false;
    if (serveNonSync !== (vista === 'nonsync')) mostra(serveNonSync ? 'nonsync' : 'attesa');
  }
  aggiornaPannelloSim();
}

// ---------------------------------------------------------------------------
// viste
// ---------------------------------------------------------------------------
const ICONE = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>',
  negato: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  errore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>',
  avviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>',
};
const iniziali = (s) => `${s?.nome?.[0] || ''}${s?.cognome?.[0] || ''}`.toUpperCase();

function mostra(v) {
  vista = v;
  for (const x of ['attesa', 'esito', 'setup', 'nonsync']) $(`#v-${x}`).hidden = x !== v;
  document.body.classList.toggle('setup-attivo', v === 'setup');
  $('#barra').hidden = v === 'setup';
  aggiornaStato();
  if ((v === 'attesa' || v === 'nonsync') && ricaricaQuandoLibero) location.reload();
}

function tornaInAttesa() {
  clearTimeout(timerEsito);
  mostra('attesa');
}

function mostraEsito(r) {
  const v = $('#v-esito');
  const classe = r.esito === 'ok' ? 'ok' : r.esito === 'errore' ? 'errore' : 'negato';
  v.className = `vista ${classe}`;
  $('#e-icona').innerHTML = ICONE[classe];

  $('#e-socio').hidden = !r.socio;
  if (r.socio) {
    $('#e-avatar').textContent = iniziali(r.socio);
    $('#e-nome').textContent = `${r.socio.nome} ${r.socio.cognome}`;
  }

  let titolo, dett = '', piano = '';
  if (r.esito === 'ok') {
    titolo = 'Buon allenamento!';
    if (r.tipo === 'ingressi') {
      dett = `Ingressi rimasti: ${r.residuo_dopo ?? '—'}${r.data_scadenza ? `<small>Carnet valido fino al ${fmtDataCompleta(r.data_scadenza)}</small>` : ''}`;
    } else if (r.data_scadenza) {
      const g = r.giorni_rimasti;
      dett = `Valido fino al ${fmtDataCompleta(r.data_scadenza)}<small>${g === 0 ? 'Ultimo giorno' : g === 1 ? '1 giorno rimasto' : `${g} giorni rimasti`}</small>`;
    }
    piano = [r.piano, r.tipo === 'ingressi' ? 'Carnet a ingressi' : 'Abbonamento a scadenza'].filter(Boolean).join(' · ');
  } else if (r.esito === 'errore') {
    titolo = 'Impossibile verificare';
    dett = esc(r.motivo);
  } else {
    titolo = 'Accesso negato';
    dett = esc(r.motivo);
  }
  $('#e-titolo').textContent = titolo;
  $('#e-dett').innerHTML = dett;
  $('#e-piano').textContent = piano;

  const a = avviso(r);
  $('#e-avviso').hidden = !a;
  if (a) $('#e-avviso').innerHTML = `${ICONE.avviso}${esc(a)}`;

  $('#e-porta').hidden = true;

  // colori e suoni identici offline: solo un piccolo badge
  $('#e-badge').hidden = !r.offline;
  $('#e-badge').textContent = `OFFLINE · ${inCoda()} da sincronizzare`;

  mostra('esito');
  clearTimeout(timerEsito);
  timerEsito = setTimeout(tornaInAttesa, DURATA_ESITO);
}

let timerNotifica = null;
function notifica(testo) {
  const n = $('#notifica');
  n.textContent = testo;
  n.hidden = false;
  clearTimeout(timerNotifica);
  timerNotifica = setTimeout(() => { n.hidden = true; }, 1800);
}

// ---------------------------------------------------------------------------
// lettura tessera
// ---------------------------------------------------------------------------
async function onCodice(codice) {
  if (!data || !codice) return;
  sbloccaAudio();
  const ts = new Date().toISOString();

  // stessa tessera entro 5 s: ignorata (nessun secondo ingresso), solo un lieve avviso
  if (filtroDoppie.controlla(codice)) {
    notifica('Tessera già letta');
    suona('lieve', RITARDO_SUONI);
    data.registraLettura({ codice, evento_id: crypto.randomUUID(), ts, doppia: true }).catch(() => {}).finally(() => sync?.aggiornaContatori());
    return;
  }

  try {
    // online entro ~2 s, altrimenti decisione locale con lo STESSO evento_id
    const r = await data.registraLettura({ codice, evento_id: crypto.randomUUID(), ts });
    // tessera valida: apre SUBITO la porta (in LAN, funziona anche offline), senza aspettare la risposta
    const apertura = r.esito === 'ok' && porta.attivo ? porta.apri() : null;
    if (!r.offline && r.ora_server && sync) sync.stato.sfasamentoMs = Date.now() - Date.parse(r.ora_server);
    await sync?.aggiornaContatori();
    suona(r.esito === 'ok' ? 'ok' : 'negato', RITARDO_SUONI);
    mostraEsito(r);
    // l'ingresso resta valido (già registrato): se il relè non risponde lo si dice sullo schermo verde
    apertura?.then((e) => { if (!e.ok && vista === 'esito') $('#e-porta').hidden = false; });
  } catch (e) {
    if (e instanceof ErroreAutorizzazione) { apriSetup('Terminale non autorizzato: il token è stato revocato o non è valido.'); return; }
    suona('negato', RITARDO_SUONI);
    if (e instanceof ErroreNonSincronizzato) {
      mostra('nonsync');
      clearTimeout(timerEsito);
      timerEsito = setTimeout(tornaInAttesa, DURATA_ESITO);
      return;
    }
    console.error(e);
    mostraEsito({ esito: 'errore', motivo: 'Errore del terminale. Rivolgiti alla reception.' });
  }
}

// ---------------------------------------------------------------------------
// configurazione del terminale (token)
// ---------------------------------------------------------------------------
function apriSetup(errore = '') {
  store.set(CHIAVE_TOKEN, null);
  sync?.ferma();
  data = null;
  sync = null;
  $('#s-errore').hidden = !errore;
  $('#s-errore').textContent = errore;
  mostra('setup');
  $('#s-token').focus();
}

$('#f-setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#s-token').value.trim();
  const tentativo = creaDataLayerTerminale({ config: CFG, token });
  try {
    const p = await tentativo.ping();
    store.set(CHIAVE_TOKEN, token);
    $('#s-token').value = '';
    nomeTerminale = p.nome;
    store.set(CHIAVE_NOME, p.nome);
    avvia();
  } catch (err) {
    $('#s-errore').hidden = false;
    $('#s-errore').textContent = err instanceof ErroreAutorizzazione ? 'Token non valido o revocato.' : `Impossibile contattare il server: ${err.message}`;
  }
});

async function apriArchivioLocale() {
  try {
    if (DEMO) await new Promise((ok) => { const r = indexedDB.deleteDatabase(NOME_DB); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
    return await apriArchivio({ nome: NOME_DB });
  } catch (e) {
    console.error('IndexedDB non disponibile: il terminale funziona solo online', e);
    return null;
  }
}

async function avvia() {
  archivio ??= await apriArchivioLocale();
  data = creaDataLayerTerminale({ config: CFG, token: store.get(CHIAVE_TOKEN), sim: SIM, demo: DEMO, archivio });
  if (!data) {
    if (remotoConfigurato(CFG)) return apriSetup();
    document.body.innerHTML = '<div class="vista"><div class="setup"><h1>Configurazione mancante</h1><p>Imposta SUPABASE_URL e SUPABASE_ANON_KEY (vedi accessi/README.md) oppure apri la pagina con <b>?demo=1</b> per la simulazione con dati demo.</p></div></div>';
    return;
  }
  sync = creaSincronizzatore({
    terminale: data,
    archivio,
    intervalloMs: CFG.SYNC_INTERVALLO_MS || 60000,
    versioneApp: VERSIONE_APP,
    onCambio: aggiornaStato,
    onNonAutorizzato: () => apriSetup('Terminale non autorizzato: il token è stato revocato o non è valido.'),
  });
  tornaInAttesa();
  await sync.aggiornaContatori();
  sync.avvia().then(() => {
    // nome del terminale per la barra di stato
    if (data && !data.forzaOffline) data.ping().then((p) => { nomeTerminale = p.nome; store.set(CHIAVE_NOME, p.nome); aggiornaStato(); }).catch(() => {});
  });
}
window.addEventListener('offline', () => { data?.segnaOffline(); aggiornaStato(); });

// ---------------------------------------------------------------------------
// lettore + simulazione
// ---------------------------------------------------------------------------
agganciaLettore(onCodice, { attivo: () => !!data && vista !== 'setup', maxGapMs: CFG.LETTORE_MAX_GAP_MS });
window.addEventListener('pointerdown', sbloccaAudio);
window.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
});

let pannelloSim = null;
const fmtOraSec = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
function aggiornaPannelloSim() {
  if (!pannelloSim) return;
  const s = sync?.stato;
  const ultima = s?.ultimaSync ? fmtOra.format(new Date(s.ultimaSync)) : 'mai';
  pannelloSim.querySelector('#sim-stato').textContent =
    `${data?.online === false ? 'Offline' : 'Online'} · in coda: ${s?.inCoda ?? 0} · ultima sincronizzazione: ${ultima}${s?.ultimoErrore ? ` · errore: ${s.ultimoErrore}` : ''}`;
  const u = porta.ultimo;
  const descr = porta.tipo === 'shelly' ? `Shelly ${porta.url}` : porta.tipo === 'sim' ? 'simulata (nessun relè)' : 'spenta';
  pannelloSim.querySelector('#sim-porta').textContent = `Porta: ${descr}`
    + (u ? ` · ultimo comando ${fmtOraSec.format(new Date(u.quando))}: ${u.ok ? `aperta${u.ms ? ` (${u.ms} ms)` : ''}` : u.errore || 'non inviato'}` : '');
}

if (SIM) {
  document.body.classList.add('sim');
  const btn = document.createElement('button');
  btn.className = 'sim-toggle';
  btn.textContent = 'SIM';
  btn.title = 'Pannello simulazione';
  const p = document.createElement('div');
  pannelloSim = p;
  p.className = 'sim-pannello';
  p.hidden = true;
  p.dataset.noLettore = '';
  p.innerHTML = `
    <h2>Simulazione lettore</h2>
    <form class="riga" id="sim-form"><input id="sim-codice" placeholder="Codice tessera" autocomplete="off"><button class="btn primario">Invia</button></form>
    ${TESSERE_TEST.map((t) => `<button class="btn" data-codice="${t.codice}">${t.etichetta} <span>· ${t.descr}</span></button>`).join('')}
    <div class="nota">Altri casi</div>
    <div class="chips">${ALTRI_CASI.map((t) => `<button class="btn piccolo" data-codice="${t.codice}" title="${t.codice}">${t.descr}</button>`).join('')}</div>
    <label class="interruttore"><input type="checkbox" id="sim-offline"> Simula offline</label>
    <div class="riga"><button class="btn piccolo" id="sim-sync">Sincronizza ora</button><button class="btn piccolo" id="sim-apri">Apri porta (prova)</button></div>
    <div class="nota" id="sim-stato"></div>
    <div class="nota" id="sim-porta"></div>
    <div class="nota">Le tessere di test esistono nei dati demo (in memoria, senza database) e nel seed di sviluppo (sql/seed-dev.sql).</div>`;
  document.body.append(btn, p);
  btn.addEventListener('click', () => { p.hidden = !p.hidden; aggiornaPannelloSim(); });
  p.addEventListener('click', (e) => { const b = e.target.closest('[data-codice]'); if (b) onCodice(b.dataset.codice); });
  p.querySelector('#sim-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = p.querySelector('#sim-codice');
    onCodice(c.value.replace(/\s+/g, '').toUpperCase());
    c.value = '';
  });
  p.querySelector('#sim-offline').addEventListener('change', (e) => {
    if (!data) return;
    data.forzaOffline = e.target.checked;
    if (e.target.checked) data.segnaOffline();
    else sync?.sincronizza();
    aggiornaStato();
  });
  p.querySelector('#sim-sync').addEventListener('click', () => sync?.sincronizza());
  p.querySelector('#sim-apri').addEventListener('click', () => porta.apri());
}

avvia();
