// Pagina staff /gestione: tessere, annullo ingressi, storico, accessi offline da verificare, terminali.
// Login con l'autenticazione di GymIN (Supabase Auth). Tutto richiede connessione.
import { fmtDataCompleta, fmtDataOra, inizioGiornoRoma, oggiRoma, normalizzaCodice } from './esito.js';
import { agganciaLettore } from './lettore.js';
import { sbloccaAudio, suona } from './suoni.js';
import { creaClientSupabase, creaDataLayerGestione } from './dataLayer.js';
import { TESSERE_TEST, ALTRI_CASI } from './demo.js';

const CFG = window.ACCESSI_CONFIG || {};
const SIM = new URLSearchParams(location.search).get('sim') === '1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nome = (s) => (s ? `${s.nome} ${s.cognome}` : '—');
const iniziali = (s) => `${s?.nome?.[0] || ''}${s?.cognome?.[0] || ''}`.toUpperCase();

let dl = null;
const stato = { soci: [], sociById: new Map(), tessere: [], scheda: 'tessere' };

// ---------------------------------------------------------------------------
// utilità UI
// ---------------------------------------------------------------------------
let timerToast;
function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${tipo}`;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, 3500);
}
function soloOnline() {
  if (navigator.onLine) return true;
  toast('Disponibile solo online', 'bad');
  return false;
}
async function azione(fn, msgOk) {
  if (!soloOnline()) return null;
  try {
    const r = await fn();
    if (msgOk) toast(msgOk);
    return r ?? true;
  } catch (e) {
    toast(e.message || 'Errore', 'bad');
    return null;
  }
}
function aggiornaOffline() { $('#offline').hidden = navigator.onLine; }
window.addEventListener('online', aggiornaOffline);
window.addEventListener('offline', aggiornaOffline);

const pillEsito = (l) => {
  if (l.esito === 'ok' && l.da_verificare) return '<span class="pill warn">Ok · da verificare</span>';
  const m = { ok: ['ok', 'Ok'], negato: ['negato', 'Negato'], doppia_lettura: ['neutro', 'Doppia lettura'], annullo: ['warn', 'Annullo'] }[l.esito] || ['neutro', l.esito];
  return `<span class="pill ${m[0]}">${m[1]}</span>`;
};
const residuoTxt = (l) => (l.residuo_prima != null || l.residuo_dopo != null ? `${l.residuo_prima ?? '—'} → ${l.residuo_dopo ?? '—'}` : '');

// ---------------------------------------------------------------------------
// cattura dal lettore ("Passa la tessera")
// ---------------------------------------------------------------------------
let cattura = null;   // { onCodice(codice) } quando si attende una tessera
let diagnosi = null;  // riceve le misure del lettore durante "Prova lettore"
agganciaLettore((codice) => {
  const c = cattura;
  if (!c) return;
  suona('lieve', 0);
  c.onCodice(codice);
}, { attivo: () => !!cattura, maxGapMs: CFG.LETTORE_MAX_GAP_MS, onDiagnosi: (info) => diagnosi?.(info) });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cattura) cattura.annulla?.(); });

function boxCattura(testo) {
  const sim = SIM ? `
    <div class="sim-box" data-no-lettore>
      <b>Simulazione lettore</b>
      <form class="riga" data-sim-form><input placeholder="Codice tessera" autocomplete="off"><button class="btn piccolo">Invia</button></form>
      <div class="riga">${[...TESSERE_TEST, ...ALTRI_CASI].map((t) => `<button class="btn piccolo" type="button" data-sim="${t.codice}" title="${esc(t.descr)}">${t.codice}</button>`).join('')}</div>
    </div>` : '';
  return `<div class="cattura"><div class="grande pulsa">${esc(testo)}</div><div>In attesa del lettore… <button class="btn piccolo" type="button" data-annulla-cattura>Annulla (Esc)</button></div>${sim}</div>`;
}
function attivaCattura(contenitore, { onCodice, annulla }) {
  sbloccaAudio();
  document.activeElement?.blur?.();
  cattura = {
    onCodice: (codice) => onCodice(normalizzaCodice(codice)),
    annulla: () => { cattura = null; annulla?.(); },
  };
  $('[data-annulla-cattura]', contenitore)?.addEventListener('click', () => cattura?.annulla());
  $('[data-sim-form]', contenitore)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('input', e.target).value;
    if (v.trim()) cattura?.onCodice(v);
  });
  $$('[data-sim]', contenitore).forEach((b) => b.addEventListener('click', () => cattura?.onCodice(b.dataset.sim)));
}
const fermaCattura = () => { cattura = null; diagnosi = null; };

// ---------------------------------------------------------------------------
// assegnazione (comune a manuale, rapida e da "tessere non associate")
// ---------------------------------------------------------------------------
async function assegna(socio, codice, modo = 'aggiungi') {
  if (!soloOnline()) return false;
  try {
    let r = await dl.assegnaTessera(socio.id, codice, modo, false);
    if (r.stato === 'conferma') {
      const altro = nome(r.altro_socio);
      if (!confirm(`La tessera ${codice} è già associata a ${altro}.\n\nRiassegnarla a ${nome(socio)}? La tessera verrà disattivata per ${altro}.`)) {
        toast('Associazione annullata');
        return false;
      }
      r = await dl.assegnaTessera(socio.id, codice, modo, true);
    }
    if (r.stato === 'gia_associata') { toast(`La tessera ${codice} è già di ${nome(socio)}`); return true; }
    toast(`Tessera ${codice} associata a ${nome(socio)}`);
    stato.tessere = await dl.tessere();
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
  }
}

// ---------------------------------------------------------------------------
// scheda TESSERE
// ---------------------------------------------------------------------------
const assegnazione = { socio: null, codicePreimpostato: null };

function cercaSoci(q) {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const parole = t.split(/\s+/);
  return stato.soci.filter((s) => {
    const testo = `${s.nome} ${s.cognome} ${s.tessera || ''}`.toLowerCase();
    return parole.every((p) => testo.includes(p));
  }).slice(0, 30);
}

async function schedaTessere(el) {
  el.innerHTML = `
    <div class="griglia">
      <section class="card" id="c-assegna">
        <h2>Assegna tessera</h2>
        <div class="campo"><label for="q-socio">Socio</label><input id="q-socio" placeholder="Cerca per nome, cognome o n. tessera GymIN" autocomplete="off"></div>
        <div id="risultati" class="risultati" hidden></div>
        <div id="sel" class="campo"></div>
      </section>
      <section class="card" id="c-rapida"></section>
      <section class="card" id="c-prova"></section>
      <section class="card" id="c-orfane" style="grid-column:1/-1"><h2>Tessere lette non associate</h2><div class="vuoto">Caricamento…</div></section>
    </div>`;

  const q = $('#q-socio', el);
  q.addEventListener('input', () => {
    const r = cercaSoci(q.value);
    const box = $('#risultati', el);
    box.hidden = !r.length;
    box.innerHTML = r.map((s) => `<button type="button" data-id="${s.id}">${esc(nome(s))}<span>${esc(s.tessera || '')}</span></button>`).join('');
  });
  $('#risultati', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    assegnazione.socio = stato.sociById.get(b.dataset.id);
    q.value = '';
    $('#risultati', el).hidden = true;
    disegnaSelezione();
  });

  disegnaSelezione();
  disegnaRapida();
  disegnaProva();
  disegnaOrfane();
}

// --- prova lettore: verifica il lettore reale e la tessera, senza associare nulla ---
const prova = { attiva: false, letture: [], ultimaDiag: null };
function disegnaProva() {
  const box = $('#c-prova');
  if (!box) return;
  if (!prova.attiva) {
    box.innerHTML = `<h2>Prova lettore</h2>
      <p>Verifica il lettore RFID: passa una tessera e vedi il codice letto, la velocità del lettore e a chi è associata. Non modifica nulla.</p>
      <div><button class="btn primario" type="button" data-avvia-prova>Avvia prova</button></div>`;
    $('[data-avvia-prova]', box).addEventListener('click', () => {
      if (!soloOnline()) return;
      prova.attiva = true;
      prova.letture = [];
      disegnaProva();
    });
    return;
  }
  const righe = prova.letture.map((l) => {
    const t = stato.tessere.find((x) => x.codice === l.codice && x.attiva);
    const socio = t ? stato.sociById.get(t.socio_id) : null;
    const esito = l.accettato === false
      ? `<span class="pill negato">Scartato</span> <span class="vuoto">troppo lento: ${l.gapMaxMs} ms tra due tasti (soglia ${l.sogliaMs} ms)</span>`
      : socio ? `<span class="pill ok">Associata</span> ${esc(nome(socio))}`
        : `<span class="pill warn">Non associata</span> <button class="btn piccolo" type="button" data-associa-codice="${esc(l.codice)}">Associa a un socio…</button>`;
    const misure = l.caratteri ? `${l.caratteri} caratteri · ${l.durataMs} ms · max ${l.gapMaxMs} ms tra due tasti` : 'simulazione';
    return `<tr><td class="mono">${esc(l.codice)}</td><td>${misure}</td><td>${esito}</td></tr>`;
  }).join('');
  box.innerHTML = `<h2>Prova lettore</h2>
    <div id="zona-prova">${boxCattura('Passa una tessera sul lettore')}</div>
    ${righe ? `<div class="tabella-wrap"><table><thead><tr><th>Codice letto</th><th>Lettura</th><th>Tessera</th></tr></thead><tbody>${righe}</tbody></table></div>` : ''}
    <div><button class="btn" type="button" data-termina-prova>Termina prova</button></div>`;
  const chiudi = () => { prova.attiva = false; fermaCattura(); disegnaProva(); };
  $('[data-termina-prova]', box).addEventListener('click', chiudi);
  $$('[data-associa-codice]', box).forEach((b) => b.addEventListener('click', () => {
    chiudi();
    assegnazione.codicePreimpostato = b.dataset.associaCodice;
    disegnaSelezione();
    $('#c-assegna').scrollIntoView({ behavior: 'smooth' });
    if (!assegnazione.socio) $('#q-socio')?.focus();
  }));
  const aggiungi = (l) => { prova.letture = [l, ...prova.letture].slice(0, 8); disegnaProva(); };
  attivaCattura($('#zona-prova', box), {
    annulla: chiudi,
    // lettura accettata: se arriva dal lettore la diagnostica è già stata registrata, altrimenti è la simulazione
    onCodice: (codice) => {
      const giaMisurata = prova.ultimaDiag?.codice === codice;
      prova.ultimaDiag = null;
      if (!giaMisurata) aggiungi({ codice });
    },
  });
  diagnosi = (info) => { prova.ultimaDiag = info; aggiungi(info); };
}

function disegnaSelezione() {
  const box = $('#sel');
  if (!box) return;
  fermaCattura();
  const s = assegnazione.socio;
  const pre = assegnazione.codicePreimpostato;
  const preHtml = pre ? `<div class="banner warn">Codice da associare: <b class="mono">${esc(pre)}</b> <button class="btn piccolo" type="button" data-togli-pre>Togli</button></div>` : '';
  if (!s) {
    box.innerHTML = `${preHtml}<div class="vuoto">Cerca e seleziona un socio.</div>`;
    $('[data-togli-pre]', box)?.addEventListener('click', () => { assegnazione.codicePreimpostato = null; disegnaSelezione(); });
    return;
  }
  const sue = stato.tessere.filter((t) => t.socio_id === s.id);
  const attive = sue.filter((t) => t.attiva);
  const vecchie = sue.filter((t) => !t.attiva).slice(0, 5);
  box.innerHTML = `
    <div class="socio-sel"><span class="avatar-s">${esc(iniziali(s))}</span>
      <div style="flex:1"><b>${esc(nome(s))}</b><div class="vuoto" style="padding:0">${s.tessera ? `N. tessera GymIN: ${esc(s.tessera)}` : 'Nessun n. tessera GymIN'}</div></div>
      <button class="btn piccolo" type="button" data-cambia>Cambia</button></div>
    <div class="campo"><label>Tessere attive</label>
      ${attive.length ? attive.map((t) => `<div class="riga"><span class="mono" style="flex:1">${esc(t.codice)}</span><span class="vuoto">dal ${fmtDataCompleta(t.creato_il.slice(0, 10))}</span><button class="btn piccolo pericolo" type="button" data-disattiva="${t.id}">Disattiva</button></div>`).join('') : '<div class="vuoto">Nessuna tessera attiva.</div>'}
      ${vecchie.length ? `<div class="vuoto">Disattivate: ${vecchie.map((t) => `${esc(t.codice)} (${esc(t.motivo_disattivazione || '')})`).join(', ')}</div>` : ''}
    </div>
    ${attive.length ? `<div class="campo"><label>Nuova tessera</label>
      <label><input type="radio" name="modo" value="sostituisci" checked> Sostituisce la tessera attuale (smarrita / guasta)</label>
      <label><input type="radio" name="modo" value="aggiungi"> Si aggiunge come seconda tessera</label></div>` : ''}
    ${preHtml}
    <div id="zona-cattura">${pre
    ? `<button class="btn primario" type="button" data-associa-pre>Associa ${esc(pre)} a ${esc(s.nome)}</button>`
    : '<button class="btn primario" type="button" data-passa>Passa la tessera</button>'}</div>`;

  const modo = () => $('input[name="modo"]:checked', box)?.value || 'aggiungi';
  $('[data-cambia]', box).addEventListener('click', () => { assegnazione.socio = null; disegnaSelezione(); $('#q-socio')?.focus(); });
  $('[data-togli-pre]', box)?.addEventListener('click', () => { assegnazione.codicePreimpostato = null; disegnaSelezione(); });
  $$('[data-disattiva]', box).forEach((b) => b.addEventListener('click', async () => {
    const motivo = prompt('Motivo della disattivazione', 'Smarrita');
    if (motivo === null) return;
    if (await azione(() => dl.disattivaTessera(b.dataset.disattiva, motivo), 'Tessera disattivata')) {
      stato.tessere = await dl.tessere();
      disegnaSelezione();
    }
  }));
  $('[data-associa-pre]', box)?.addEventListener('click', async () => {
    if (await assegna(s, pre, modo())) { assegnazione.codicePreimpostato = null; disegnaSelezione(); disegnaOrfane(); disegnaRapida(); }
  });
  $('[data-passa]', box)?.addEventListener('click', () => {
    if (!soloOnline()) return;
    const zona = $('#zona-cattura', box);
    zona.innerHTML = boxCattura(`Passa la tessera per ${s.nome}`);
    attivaCattura(zona, {
      annulla: disegnaSelezione,
      onCodice: async (codice) => {
        fermaCattura();
        zona.innerHTML = `<div class="cattura"><div>Codice letto</div><div class="codice">${esc(codice)}</div>
          <div class="riga" style="justify-content:center"><button class="btn primario" type="button" data-ok>Associa a ${esc(nome(s))}</button><button class="btn" type="button" data-no>Annulla</button></div></div>`;
        $('[data-no]', zona).addEventListener('click', disegnaSelezione);
        $('[data-ok]', zona).addEventListener('click', async () => {
          if (await assegna(s, codice, modo())) { disegnaSelezione(); disegnaRapida(); }
        });
      },
    });
  });
}

// --- associazione rapida ---
const rapida = { attiva: false, coda: [], fatti: 0 };
async function disegnaRapida() {
  const box = $('#c-rapida');
  if (!box) return;
  if (!rapida.attiva) {
    box.innerHTML = '<h2>Associazione rapida</h2><div class="vuoto">Caricamento…</div>';
    try {
      rapida.coda = await dl.sociValidiSenzaTessera(stato.soci, stato.tessere);
    } catch (e) { box.innerHTML = `<h2>Associazione rapida</h2><div class="banner bad">${esc(e.message)}</div>`; return; }
    box.innerHTML = `<h2>Associazione rapida</h2>
      <p>Per il primo caricamento: scorre i soci con <b>abbonamento valido</b> e <b>senza tessera</b>. Passi la tessera, viene associata e si passa al successivo.</p>
      <div class="riga"><b style="font-size:22px">${rapida.coda.length}</b> <span class="vuoto">soci da associare</span></div>
      <div><button class="btn primario" type="button" data-avvia ${rapida.coda.length ? '' : 'disabled'}>Avvia associazione rapida</button></div>`;
    $('[data-avvia]', box).addEventListener('click', () => { if (!soloOnline()) return; rapida.attiva = true; rapida.fatti = 0; disegnaRapida(); });
    return;
  }
  const s = rapida.coda[0];
  if (!s) { rapida.attiva = false; toast(`Associazione rapida completata: ${rapida.fatti} tessere`); disegnaRapida(); return; }
  box.innerHTML = `<h2>Associazione rapida <small>${rapida.fatti} associati · ${rapida.coda.length} restanti</small></h2>
    <div class="socio-sel"><span class="avatar-s">${esc(iniziali(s))}</span><div><b>${esc(nome(s))}</b><div class="vuoto" style="padding:0">${esc(s.esito.piano || '')}${s.tessera ? ` · n. GymIN ${esc(s.tessera)}` : ''}</div></div></div>
    <div id="zona-rapida">${boxCattura(`Passa la tessera di ${s.nome}`)}</div>
    <div class="riga"><button class="btn" type="button" data-salta>Salta</button><button class="btn" type="button" data-termina>Termina</button></div>`;
  const avanti = () => { rapida.coda.shift(); disegnaRapida(); };
  $('[data-salta]', box).addEventListener('click', () => { fermaCattura(); avanti(); });
  $('[data-termina]', box).addEventListener('click', () => { fermaCattura(); rapida.attiva = false; disegnaRapida(); });
  attivaCattura($('#zona-rapida', box), {
    annulla: () => { rapida.attiva = false; disegnaRapida(); },
    onCodice: async (codice) => {
      fermaCattura();
      if (await assegna(s, codice, 'aggiungi')) { rapida.fatti += 1; avanti(); } else disegnaRapida();
    },
  });
}

// --- tessere lette non associate ---
async function disegnaOrfane() {
  const box = $('#c-orfane');
  if (!box) return;
  let righe;
  try { righe = await dl.tessereNonAssociate(); } catch (e) { box.innerHTML = `<h2>Tessere lette non associate</h2><div class="banner bad">${esc(e.message)}</div>`; return; }
  box.innerHTML = `<h2>Tessere lette non associate <small>${righe.length}</small></h2>
    <p>Tessere passate al terminale che non risultano di nessun socio. Scegli il socio e associa il codice, senza ripassare la tessera.</p>
    ${righe.length ? `<div class="tabella-wrap"><table><thead><tr><th>Codice</th><th>Letture</th><th>Ultima</th><th></th></tr></thead><tbody>
      ${righe.map((r) => `<tr><td class="mono">${esc(r.codice)}</td><td>${r.letture}</td><td>${fmtDataOra(r.ultima_lettura)}</td><td><button class="btn piccolo" type="button" data-codice="${esc(r.codice)}">Assegna…</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vuoto">Nessuna.</div>'}`;
  $$('[data-codice]', box).forEach((b) => b.addEventListener('click', () => {
    assegnazione.codicePreimpostato = b.dataset.codice;
    disegnaSelezione();
    $('#c-assegna').scrollIntoView({ behavior: 'smooth' });
    if (!assegnazione.socio) $('#q-socio')?.focus();
  }));
}

// ---------------------------------------------------------------------------
// scheda ANNULLA INGRESSO
// ---------------------------------------------------------------------------
async function schedaIngressi(el) {
  el.innerHTML = '<section class="card"><h2>Annulla ultimo ingresso</h2><div class="vuoto">Caricamento…</div></section>';
  const righe = await dl.ultimiIngressi(40);
  el.innerHTML = `<section class="card"><h2>Annulla ultimo ingresso</h2>
    <p>Ripristina un ingresso consentito per errore (es. tessera passata due volte o dal socio sbagliato): l'ingresso scalato torna disponibile e resta traccia nello storico.</p>
    ${righe.length ? `<div class="tabella-wrap"><table><thead><tr><th>Data/ora</th><th>Socio</th><th>Abbonamento</th><th>Residuo</th><th></th></tr></thead><tbody>
      ${righe.map((l) => `<tr><td>${fmtDataOra(l.ts_terminale || l.ts_server)}</td><td>${esc(nome(l.socio))}</td><td>${esc(l.piano || '')}</td><td>${residuoTxt(l)}</td>
        <td><button class="btn piccolo pericolo" type="button" data-annulla="${l.id}">Annulla ingresso</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vuoto">Nessun ingresso da annullare.</div>'}</section>`;
  $$('[data-annulla]', el).forEach((b) => b.addEventListener('click', async () => {
    const motivo = prompt('Motivo dell\'annullo', 'Ingresso registrato per errore');
    if (motivo === null) return;
    const r = await azione(() => dl.annullaIngresso(Number(b.dataset.annulla), motivo));
    if (r) {
      toast(r.ingresso_ripristinato ? `Ingresso annullato · residuo ripristinato a ${r.residuo}` : 'Ingresso annullato');
      schedaIngressi(el);
    }
  }));
}

// ---------------------------------------------------------------------------
// scheda STORICO
// ---------------------------------------------------------------------------
const filtri = { socio: '', dal: oggiRoma(), al: oggiRoma(), esito: '', offline: '' };
function tabellaLog(righe) {
  if (!righe.length) return '<div class="vuoto">Nessun accesso trovato.</div>';
  return `<div class="tabella-wrap"><table><thead><tr><th>Data/ora</th><th>Socio</th><th>Codice</th><th>Esito</th><th>Motivo</th><th>Abbonamento</th><th>Residuo</th><th>Offline</th><th>Terminale</th></tr></thead><tbody>
    ${righe.map((l) => `<tr class="${l.annullato_il ? 'annullato' : ''}"><td>${fmtDataOra(l.ts_terminale || l.ts_server)}</td><td>${esc(nome(l.socio))}</td><td class="mono">${esc(l.codice)}</td>
      <td>${pillEsito(l)}${l.annullato_il ? ' <span class="pill warn">annullato</span>' : ''}</td><td>${esc(l.motivo || '')}</td><td>${esc(l.piano || '')}</td><td>${residuoTxt(l)}</td>
      <td>${l.offline ? 'sì' : ''}</td><td>${esc(l.terminale?.nome || '')}</td></tr>`).join('')}
  </tbody></table></div>`;
}
async function schedaStorico(el) {
  el.innerHTML = `<section class="card"><h2>Storico accessi</h2>
    <form id="f-storico" class="riga">
      <input name="socio" placeholder="Socio" value="${esc(filtri.socio)}">
      <label>dal <input type="date" name="dal" value="${filtri.dal}"></label>
      <label>al <input type="date" name="al" value="${filtri.al}"></label>
      <select name="esito">${[['', 'Tutti gli esiti'], ['ok', 'Ok'], ['negato', 'Negato'], ['doppia_lettura', 'Doppia lettura'], ['annullo', 'Annullo']].map(([v, t]) => `<option value="${v}"${filtri.esito === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <select name="offline">${[['', 'Online e offline'], ['si', 'Solo offline'], ['no', 'Solo online']].map(([v, t]) => `<option value="${v}"${filtri.offline === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn primario">Cerca</button>
    </form>
    <div id="esiti-storico" class="vuoto">Caricamento…</div></section>`;
  const carica = async () => {
    const f = { esito: filtri.esito, offline: filtri.offline };
    if (filtri.dal) f.dal = inizioGiornoRoma(filtri.dal);
    if (filtri.al) {
      const d = new Date(`${filtri.al}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
      f.al = inizioGiornoRoma(d.toISOString().slice(0, 10));
    }
    if (filtri.socio.trim()) {
      const parole = filtri.socio.trim().toLowerCase().split(/\s+/);
      f.socioIds = stato.soci.filter((s) => parole.every((p) => `${s.nome} ${s.cognome} ${s.tessera || ''}`.toLowerCase().includes(p))).map((s) => s.id).slice(0, 200);
    }
    try {
      const righe = await dl.storico(f);
      $('#esiti-storico', el).className = '';
      $('#esiti-storico', el).innerHTML = `${righe.length >= 500 ? '<div class="banner warn">Mostrati i 500 accessi più recenti: restringi i filtri.</div>' : ''}${tabellaLog(righe)}`;
    } catch (e) { $('#esiti-storico', el).innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  };
  $('#f-storico', el).addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(filtri, Object.fromEntries(new FormData(e.target)));
    carica();
  });
  carica();
}

// ---------------------------------------------------------------------------
// scheda OFFLINE DA VERIFICARE
// ---------------------------------------------------------------------------
async function aggiornaContaVerificare() {
  try {
    const n = (await dl.daVerificare()).length;
    $('#n-verificare').hidden = !n;
    $('#n-verificare').textContent = n;
  } catch { /* non bloccante */ }
}
async function schedaVerificare(el) {
  el.innerHTML = '<section class="card"><h2>Accessi offline da verificare</h2><div class="vuoto">Caricamento…</div></section>';
  const righe = await dl.daVerificare();
  el.innerHTML = `<section class="card"><h2>Accessi offline da verificare <small>${righe.length}</small></h2>
    <p>Ingressi consentiti dal terminale mentre era offline che, al momento della sincronizzazione, il server non avrebbe consentito (abbonamento scaduto, ingressi esauriti, tessera disattivata…). L'ingresso è avvenuto e resta registrato, senza scalare ingressi sotto zero: verifica con il socio e segna come verificato.</p>
    ${righe.length ? `<div class="tabella-wrap"><table><thead><tr><th>Avvenuto il</th><th>Socio</th><th>Codice</th><th>Motivo (server)</th><th>Abbonamento</th><th>Terminale</th><th></th></tr></thead><tbody>
      ${righe.map((l) => `<tr><td>${fmtDataOra(l.ts_terminale)}</td><td>${esc(nome(l.socio))}</td><td class="mono">${esc(l.codice)}</td><td>${esc(l.motivo || '')}</td><td>${esc(l.piano || '')}</td><td>${esc(l.terminale?.nome || '')}</td>
        <td><button class="btn piccolo" type="button" data-verifica="${l.id}">Segna verificato</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vuoto">Nessun accesso da verificare.</div>'}</section>`;
  $$('[data-verifica]', el).forEach((b) => b.addEventListener('click', async () => {
    const nota = prompt('Nota (facoltativa)', '');
    if (nota === null) return;
    if (await azione(() => dl.segnaVerificato(Number(b.dataset.verifica), nota), 'Segnato come verificato')) {
      schedaVerificare(el);
      aggiornaContaVerificare();
    }
  }));
}

// ---------------------------------------------------------------------------
// scheda TERMINALI
// ---------------------------------------------------------------------------
const MIN_CONTATTO_ONLINE = 3;   // minuti: oltre, il terminale è considerato non raggiungibile
function rigaTerminale(t) {
  const st = t.stato || {};
  const minuti = t.ultimo_contatto ? (Date.now() - Date.parse(t.ultimo_contatto)) / 60000 : Infinity;
  const statoPill = !t.attivo ? '<span class="pill neutro">Revocato</span>'
    : minuti <= MIN_CONTATTO_ONLINE ? '<span class="pill ok">Online</span>'
      : `<span class="pill warn">Non raggiungibile${Number.isFinite(minuti) ? ` da ${minuti < 120 ? `${Math.round(minuti)} min` : `${Math.round(minuti / 60)} h`}` : ''}</span>`;
  const coda = st.in_coda == null ? '—'
    : st.in_coda ? `<span class="pill warn">${st.in_coda}</span>${st.eventi_con_errori ? ` <span class="pill negato" title="Eventi rifiutati dal server: verranno ritentati">${st.eventi_con_errori} con errori</span>` : ''}` : '0';
  const cache = st.cache_ore == null ? '—' : `${st.cache_vecchia ? '<span class="pill warn">' : ''}aggiornati ${st.cache_ore < 1 ? 'ora' : `${Math.round(st.cache_ore)} h fa`}${st.cache_vecchia ? '</span>' : ''}`;
  const orologio = st.sfasamento_ms == null ? '—'
    : st.orologio_sfasato ? `<span class="pill negato">sfasato di ${Math.round(Math.abs(st.sfasamento_ms) / 60000)} min</span>` : 'ok';
  return `<tr><td>${esc(t.nome)}${st.versione_app ? `<div class="vuoto" style="padding:0;font-size:12px">v. ${esc(st.versione_app)}</div>` : ''}</td><td>${statoPill}</td>
    <td>${fmtDataOra(t.ultimo_contatto) || '—'}</td><td>${fmtDataOra(t.ultima_sync) || '—'}</td><td>${coda}</td><td>${cache}</td><td>${orologio}</td>
    <td><div class="riga">${t.attivo ? `<button class="btn piccolo" type="button" data-sync="${t.id}" ${t.sync_richiesta_il ? 'disabled title="Richiesta già inviata"' : ''}>Sincronizza ora</button>
      <button class="btn piccolo pericolo" type="button" data-revoca="${t.id}">Revoca</button>` : ''}</div></td></tr>`;
}

async function schedaTerminali(el, nuovo = null) {
  const righe = await dl.terminali();
  const urlIngresso = new URL('../ingresso/', location.href).href;
  el.innerHTML = `<div class="griglia">
    <section class="card" style="grid-column:1/-1"><h2>Terminali</h2>
      <p>Stato comunicato da ciascun terminale a ogni sincronizzazione (circa ogni minuto quando è online). La coda contiene gli accessi registrati offline non ancora inviati al server.</p>
      ${righe.length ? `<div class="tabella-wrap"><table><thead><tr><th>Nome</th><th>Stato</th><th>Ultimo contatto</th><th>Ultima sincronizzazione</th><th>Accessi in coda</th><th>Dati locali</th><th>Orologio</th><th></th></tr></thead><tbody>
        ${righe.map(rigaTerminale).join('')}
      </tbody></table></div>` : '<div class="vuoto">Nessun terminale.</div>'}
    </section>
    <section class="card"><h2>Nuovo terminale</h2>
      <p>Crea il ruolo "terminale ingresso" per un PC: riceve un token che consente <b>solo</b> di registrare le letture (nessun accesso ai dati dei soci né alle funzioni di gestione).</p>
      <form id="f-term" class="riga"><input name="nome" placeholder="Es. Ingresso principale" required><button class="btn primario">Crea</button></form>
      ${nuovo ? `<div class="banner ok">Terminale "${esc(nuovo.nome)}" creato. Copia ora il token: <b>non verrà più mostrato</b>.</div>
        <div class="token" id="token-nuovo">${esc(nuovo.token)}</div>
        <div class="riga"><button class="btn" type="button" data-copia>Copia token</button></div>
        <p>Sul PC dell'ingresso apri <b>${esc(urlIngresso)}</b> e incolla il token, oppure apri una volta:<br><span class="mono" style="word-break:break-all">${esc(urlIngresso)}?token=${esc(nuovo.token)}</span></p>` : ''}
    </section></div>`;
  $('#f-term', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await azione(() => dl.creaTerminale(new FormData(e.target).get('nome')));
    if (r) schedaTerminali(el, r);
  });
  $('[data-copia]', el)?.addEventListener('click', () => navigator.clipboard?.writeText(nuovo.token).then(() => toast('Token copiato')));
  $$('[data-sync]', el).forEach((b) => b.addEventListener('click', async () => {
    if (await azione(() => dl.richiediSync(b.dataset.sync), 'Richiesta inviata: il terminale sincronizza entro un minuto (se è online)')) setTimeout(() => schedaTerminali(el), 1500);
  }));
  $$('[data-revoca]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Revocare questo terminale? Smetterà subito di funzionare finché non viene configurato con un nuovo token.')) return;
    if (await azione(() => dl.revocaTerminale(b.dataset.revoca), 'Terminale revocato')) schedaTerminali(el);
  }));
}

// ---------------------------------------------------------------------------
// navigazione e avvio
// ---------------------------------------------------------------------------
const SCHEDE = { tessere: schedaTessere, ingressi: schedaIngressi, storico: schedaStorico, verificare: schedaVerificare, terminali: schedaTerminali };
async function apri(nomeScheda) {
  fermaCattura();
  rapida.attiva = false;
  stato.scheda = nomeScheda;
  $$('#schede [data-scheda]').forEach((b) => b.classList.toggle('attiva', b.dataset.scheda === nomeScheda));
  const el = $('#contenuto');
  try {
    if (!navigator.onLine) throw new Error('Disponibile solo online');
    await SCHEDE[nomeScheda](el);
  } catch (e) {
    el.innerHTML = `<section class="card"><div class="banner bad">${esc(e.message)}</div></section>`;
  }
}
$('#schede').addEventListener('click', (e) => { const b = e.target.closest('[data-scheda]'); if (b) apri(b.dataset.scheda); });

async function caricaDati() {
  [stato.soci, stato.tessere] = await Promise.all([dl.soci(), dl.tessere()]);
  stato.sociById = new Map(stato.soci.map((s) => [s.id, s]));
}

async function entra(sessione) {
  $('#v-login').hidden = true;
  $('#v-app').hidden = false;
  $('#utente').textContent = sessione.user?.email || '';
  $('#esci').hidden = false;
  try {
    await caricaDati();
  } catch (e) {
    $('#contenuto').innerHTML = `<section class="card"><div class="banner bad">Impossibile caricare i dati: ${esc(e.message)}</div></section>`;
    return;
  }
  aggiornaContaVerificare();
  apri(stato.scheda);
}

async function avvio() {
  aggiornaOffline();
  if (!navigator.onLine) { $('#v-login').hidden = true; return; }
  let supa;
  try { supa = await creaClientSupabase(CFG); } catch (e) { toast(`Supabase non caricato: ${e.message}`, 'bad'); }
  if (!supa) { $('#v-config').hidden = false; return; }
  dl = creaDataLayerGestione(supa);
  const s = await dl.sessione().catch(() => null);
  if (s) return entra(s);
  $('#v-login').hidden = false;
}

$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#l-errore').hidden = true;
  try {
    const r = await dl.accedi($('#l-email').value, $('#l-pwd').value);
    entra(r.session);
  } catch (err) {
    $('#l-errore').hidden = false;
    $('#l-errore').textContent = err.message === 'Invalid login credentials' ? 'Email o password non corrette' : err.message;
  }
});
$('#esci').addEventListener('click', async () => { await dl?.esci(); location.reload(); });
window.addEventListener('online', () => { if (!dl) avvio(); });

avvio();
