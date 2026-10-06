// Schermata kiosk /ingresso
import { avviso, creaFiltroDoppie, fmtDataCompleta, TZ } from './esito.js';
import { agganciaLettore } from './lettore.js';
import { sbloccaAudio, suona } from './suoni.js';
import { creaDataLayerTerminale, remotoConfigurato, ErroreAutorizzazione } from './dataLayer.js';
import { TESSERE_TEST, ALTRI_CASI } from './demo.js';

const CFG = window.ACCESSI_CONFIG || {};
const DURATA_ESITO = CFG.DURATA_ESITO_MS || 3000;
const RITARDO_SUONI = CFG.RITARDO_SUONI_MS ?? 150;
const SOGLIA_OROLOGIO_MS = 3 * 60 * 1000;   // avvisa se il PC e il server differiscono di più di 3 minuti
const CHIAVE_TOKEN = 'gymin.accessi.token';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';                 // simulazione con dati in memoria, mai il database
const SIM = params.get('sim') === '1' || DEMO;

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

let data = null;          // sorgente dati (dataLayer)
let nomeTerminale = '';
let online = null;        // ultimo stato noto della connessione col server
let sfasamentoMs = 0;     // ora del PC - ora del server
let timerEsito = null;
const filtroDoppie = creaFiltroDoppie();

// ---------------------------------------------------------------------------
// orologio e barra di stato
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

function aggiornaBarra() {
  const sx = [];
  if (data?.tipo === 'demo') sx.push('<span class="badge">SIMULAZIONE · dati demo</span>');
  else if (nomeTerminale) sx.push(esc(nomeTerminale));
  if (SIM && data?.tipo !== 'demo') sx.push('<span class="badge">SIM</span>');
  $('#b-sx').innerHTML = sx.join(' ');

  const dx = [];
  if (Math.abs(sfasamentoMs) > SOGLIA_OROLOGIO_MS) {
    dx.push(`<span class="giallo">Orologio del PC sfasato di ${Math.round(Math.abs(sfasamentoMs) / 60000)} min</span>`);
  }
  if (data?.tipo === 'remoto' && online !== null) {
    dx.push(`<span class="punto${online ? '' : ' off'}"></span>${online ? 'Online' : 'Server non raggiungibile'}`);
  }
  $('#b-dx').innerHTML = dx.join(' &nbsp; ');
}

function registraOraServer(oraServer) {
  if (!oraServer) return;
  sfasamentoMs = Date.now() - Date.parse(oraServer);
  if (Math.abs(sfasamentoMs) > SOGLIA_OROLOGIO_MS) console.warn(`Orologio del PC sfasato di ${Math.round(sfasamentoMs / 1000)} s rispetto al server`);
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iniziali = (s) => `${s?.nome?.[0] || ''}${s?.cognome?.[0] || ''}`.toUpperCase();

function mostra(vista) {
  for (const v of ['attesa', 'esito', 'setup']) $(`#v-${v}`).hidden = v !== vista;
  document.body.classList.toggle('setup-attivo', vista === 'setup');
  $('#barra').hidden = vista === 'setup';
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
    data.registraLettura({ codice, evento_id: crypto.randomUUID(), ts, doppia: true }).catch(() => {});
    return;
  }

  const evento_id = crypto.randomUUID();
  try {
    const r = await data.registraLettura({ codice, evento_id, ts });
    online = true;
    registraOraServer(r.ora_server);
    suona(r.esito === 'ok' ? 'ok' : 'negato', RITARDO_SUONI);
    mostraEsito(r);
  } catch (e) {
    if (e instanceof ErroreAutorizzazione) { apriSetup('Terminale non autorizzato: il token è stato revocato o non è valido.'); return; }
    online = false;
    // fase 1 (solo online): nessun fallback locale ancora
    suona('negato', RITARDO_SUONI);
    mostraEsito({ esito: 'errore', motivo: 'Server non raggiungibile. Riprova o rivolgiti alla reception.' });
  } finally {
    aggiornaBarra();
  }
}

// ---------------------------------------------------------------------------
// configurazione del terminale (token)
// ---------------------------------------------------------------------------
function apriSetup(errore = '') {
  store.set(CHIAVE_TOKEN, null);
  data = null;
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
    avvia(p);
  } catch (err) {
    $('#s-errore').hidden = false;
    $('#s-errore').textContent = err instanceof ErroreAutorizzazione ? 'Token non valido o revocato.' : `Impossibile contattare il server: ${err.message}`;
  }
});

function avvia(ping = null) {
  data = creaDataLayerTerminale({ config: CFG, token: store.get(CHIAVE_TOKEN), sim: SIM, demo: DEMO });
  if (!data) {
    if (remotoConfigurato(CFG)) return apriSetup();
    document.body.innerHTML = '<div class="vista"><div class="setup"><h1>Configurazione mancante</h1><p>Imposta SUPABASE_URL e SUPABASE_ANON_KEY (vedi accessi/README.md) oppure apri la pagina con <b>?sim=1</b> per la simulazione con dati demo.</p></div></div>';
    return;
  }
  if (ping) { nomeTerminale = ping.nome; online = true; registraOraServer(ping.ora_server); }
  tornaInAttesa();
  aggiornaBarra();
  if (!ping) verificaConnessione();
}

// controllo periodico della connessione (e dell'orologio)
async function verificaConnessione() {
  if (!data) return;
  try {
    const p = await data.ping();
    nomeTerminale = p.nome;
    online = true;
    registraOraServer(p.ora_server);
  } catch (e) {
    if (e instanceof ErroreAutorizzazione) return apriSetup('Terminale non autorizzato: il token è stato revocato o non è valido.');
    online = false;
  }
  aggiornaBarra();
}
setInterval(verificaConnessione, 60_000);
window.addEventListener('online', verificaConnessione);
window.addEventListener('offline', () => { online = false; aggiornaBarra(); });

// ---------------------------------------------------------------------------
// lettore + simulazione
// ---------------------------------------------------------------------------
agganciaLettore(onCodice, { attivo: () => !!data && $('#v-setup').hidden });
window.addEventListener('pointerdown', sbloccaAudio);
window.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
});

if (SIM) {
  document.body.classList.add('sim');
  const btn = document.createElement('button');
  btn.className = 'sim-toggle';
  btn.textContent = 'SIM';
  btn.title = 'Pannello simulazione';
  const p = document.createElement('div');
  p.className = 'sim-pannello';
  p.hidden = true;
  p.dataset.noLettore = '';
  p.innerHTML = `
    <h2>Simulazione lettore</h2>
    <form class="riga" id="sim-form"><input id="sim-codice" placeholder="Codice tessera" autocomplete="off"><button class="btn primario">Invia</button></form>
    ${TESSERE_TEST.map((t) => `<button class="btn" data-codice="${t.codice}">${t.etichetta} <span>· ${t.descr}</span></button>`).join('')}
    <div class="nota">Altri casi</div>
    <div class="chips">${ALTRI_CASI.map((t) => `<button class="btn piccolo" data-codice="${t.codice}" title="${t.codice}">${t.descr}</button>`).join('')}</div>
    <div class="nota">Le tessere di test esistono nei dati demo (in memoria, senza database) e nel seed di sviluppo (sql/seed-dev.sql).</div>`;
  document.body.append(btn, p);
  btn.addEventListener('click', () => { p.hidden = !p.hidden; });
  p.addEventListener('click', (e) => { const b = e.target.closest('[data-codice]'); if (b) onCodice(b.dataset.codice); });
  p.querySelector('#sim-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = p.querySelector('#sim-codice');
    onCodice(c.value.replace(/\s+/g, '').toUpperCase());
    c.value = '';
  });
}

avvia();
