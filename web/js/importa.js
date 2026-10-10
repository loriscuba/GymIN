// Cruscotto "Import abbonamenti" (visibile a tutti gli utenti staff).
// Legge i file DBF del vecchio gestionale (scelti da Esplora risorse, vedi legacydbf.js)
// oppure abbonamenti.csv prodotto da tools/import-legacy/dbf_to_csv.py, e li confronta col DB.
// Scrive sulla tabella abbonamenti: non crea soci, piani o pagamenti. Sui soci toccati
// valorizza solo soci.aggiornato_da_import (badge "UP" nelle anagrafiche).
//   - socio collegato via soci.cod_cli, piano via piani.nome
//   - stesso socio + piano + data_inizio = stesso abbonamento (niente doppioni)
//   - righe importabili una a una o in blocco, sempre dopo conferma
import { getSupa, fetchAll } from './data.js?v=__BUILD__';
import { abbonamentiDaDbf } from './legacydbf.js?v=__BUILD__';
import { confronta, applica, IMPORTABILI } from './importlogic.js?v=__BUILD__';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHOW_MAX = 300;   // righe disegnate in tabella (la selezione vale su tutte le righe filtrate)

const STATI = {
  nuovo: ['Nuovo', 'g'], diverso: ['Diverso', 'w'], presente: ['Già presente', 'n'],
  nosocio: ['Socio mancante', 'b'], nopiano: ['Piano mancante', 'b'],
};

// ---- CSV minimale (virgolette e newline nei campi), come tools/import-legacy/import.mjs ----
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].length))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString('it-IT') : '—');

let deps = {};            // { toast, askConfirm, onDone }
let csvRows = null;       // righe grezze del CSV
let rows = [];            // righe analizzate
const sel = new Set();    // indici selezionati
const state = { filtro: 'importabili', query: '', soloCorrenti: true, anno: '' };   // anno: '' | 'ge:2025' | 'eq:2023'

export function initImporta(d) {
  deps = d;
  $('#imp-file').addEventListener('change', async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    try {
      const csv = files.find((f) => /\.csv$/i.test(f.name));
      if (csv) {
        csvRows = parseCSV(await csv.text());
        if (!csvRows.length || !('cod_cli' in csvRows[0]) || !('piano_nome' in csvRows[0])) {
          csvRows = null; throw new Error('Il file non sembra abbonamenti.csv (mancano le colonne cod_cli / piano_nome)');
        }
        $('#imp-nomefile').textContent = `${csv.name} · ${csvRows.length} righe`;
      } else {
        $('#imp-nomefile').textContent = 'Lettura file DBF…';
        const { rows: r, info } = await abbonamentiDaDbf(files);
        csvRows = r;
        $('#imp-nomefile').textContent = `${info} · ${csvRows.length} abbonamenti`;
      }
      await analizza();
    } catch (err) { $('#imp-nomefile').textContent = ''; deps.toast(`Errore lettura file: ${err.message || err}`, 'warn'); }
    e.target.value = '';
  });
  $('#imp-correnti').addEventListener('change', (e) => { state.soloCorrenti = e.target.checked; if (csvRows) analizza(); });
  $('#imp-filtri').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    state.filtro = c.dataset.f; render();
  });
  $('#imp-anno').addEventListener('change', (e) => { state.anno = e.target.value; render(); });
  let t; $('#imp-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.query = e.target.value; render(); }, 150); });
  $('#imp-all').addEventListener('change', (e) => {
    filtrate().filter((r) => IMPORTABILI.has(r.stato)).forEach((r) => (e.target.checked ? sel.add(r.i) : sel.delete(r.i)));
    render();
  });
  $('#imp-table tbody').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-sel]'); if (!cb) return;
    cb.checked ? sel.add(+cb.dataset.sel) : sel.delete(+cb.dataset.sel);
    aggiornaBottone();
  });
  $('#imp-table tbody').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-one]'); if (b) importa([+b.dataset.one]);
  });
  $('#imp-go').addEventListener('click', () => importa([...sel]));
}

// confronta il CSV col DB (solo letture)
async function analizza() {
  $('#imp-table tbody').innerHTML = msg('Confronto col database in corso…');
  const supa = await getSupa();
  const [soci, piani, abb] = await Promise.all([
    fetchAll(supa, 'soci', 'id,cod_cli,nome,cognome', (q) => q.not('cod_cli', 'is', null)),
    fetchAll(supa, 'piani', 'id,nome,durata_mesi,entrate'),
    fetchAll(supa, 'abbonamenti', 'id,socio_id,piano_id,data_inizio,data_scadenza,entrate_residue,stato'),
  ]);
  rows = confronta(csvRows, { soci, piani, abb }, { soloCorrenti: state.soloCorrenti });
  sel.clear();
  opzioniAnno();
  render();
}

// tendina anni: "dal ... in poi" e "solo ...", dagli anni presenti nel file
function opzioniAnno() {
  const anni = [...new Set(rows.map((r) => r.anno).filter(Boolean))].sort().reverse();
  if (state.anno && !anni.includes(state.anno.slice(3))) state.anno = '';
  const opt = (v, t) => `<option value="${v}"${v === state.anno ? ' selected' : ''}>${t}</option>`;
  $('#imp-anno').innerHTML = opt('', 'Scadenza: tutti gli anni')
    + `<optgroup label="Dal … in poi">${anni.slice(0, -1).map((a) => opt(`ge:${a}`, `Scadenza dal ${a} in poi`)).join('')}</optgroup>`
    + `<optgroup label="Solo un anno">${anni.map((a) => opt(`eq:${a}`, `Scadenza nel ${a}`)).join('')}</optgroup>`;
}
const inAnno = (r) => !state.anno || (state.anno.startsWith('ge:') ? r.anno >= state.anno.slice(3) : r.anno === state.anno.slice(3));

function filtrate() {
  const q = state.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (!inAnno(r)) return false;
    if (state.filtro === 'importabili' ? !IMPORTABILI.has(r.stato) : state.filtro !== 'tutti' && r.stato !== state.filtro) return false;
    return !q || `${r.cod} ${r.socio} ${r.piano}`.toLowerCase().includes(q);
  });
}

const msg = (t) => `<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:28px">${t}</td></tr>`;
const val = (k, v) => (k === 'data_scadenza' ? fmtD(v) : v ?? '—');
function dettaglio(r) {
  if (r.stato === 'nosocio') return 'Nessun socio con questo codice cliente: il socio non viene creato';
  if (r.stato === 'nopiano') return 'Piano inesistente in GymIN: crealo prima in Abbonamenti';
  const n = r.nuovo;
  if (r.dup) return 'Riga doppia nel CSV: già conteggiata sopra';
  if (r.stato === 'diverso') {
    const lab = { data_scadenza: 'Scadenza', entrate_residue: 'Entrate', stato: 'Stato' };
    return Object.keys(r.diff).map((k) => `${lab[k]}: ${esc(val(k, r.ex[k]))} → <b>${esc(val(k, n[k]))}</b>`).join('<br>');
  }
  return `${fmtD(n.data_inizio)} → ${fmtD(n.data_scadenza)}${n.entrate_residue != null ? ` · ${n.entrate_residue} entrate` : ''} · ${n.stato}`;
}

function render() {
  const nell = rows.filter(inAnno);   // i conteggi dei filtri seguono l'anno scelto
  const cnt = (s) => nell.filter((r) => r.stato === s).length;
  document.querySelectorAll('#imp-filtri .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.f === state.filtro);
    const n = c.dataset.f === 'tutti' ? nell.length : c.dataset.f === 'importabili' ? cnt('nuovo') + cnt('diverso') : cnt(c.dataset.f);
    c.querySelector('span').textContent = csvRows ? ` ${n}` : '';
  });
  if (!csvRows) { $('#imp-table tbody').innerHTML = msg('Clicca <b>Scegli file</b> e seleziona dalla cartella del vecchio gestionale <b>tessere.dbf</b> e <b>anagraf.dbf</b> (Ctrl+clic per sceglierne più di uno).<br>In alternativa puoi caricare abbonamenti.csv.'); aggiornaBottone(); return; }
  const list = filtrate();
  $('#imp-table tbody').innerHTML = list.slice(0, SHOW_MAX).map((r) => {
    const [lab, cls] = STATI[r.stato];
    const ok = IMPORTABILI.has(r.stato);
    return `<tr><td>${ok ? `<input type="checkbox" data-sel="${r.i}" ${sel.has(r.i) ? 'checked' : ''} aria-label="Seleziona">` : ''}</td>
      <td class="mono">${esc(r.cod)}</td><td>${esc(r.socio || '—')}</td><td><span class="plan-pill">${esc(r.piano)}</span></td>
      <td><span class="tag ${cls}">${lab}</span></td><td style="font-size:12.5px">${dettaglio(r)}</td>
      <td>${ok ? `<button class="btn-ghost btn-xs" data-one="${r.i}">${r.stato === 'nuovo' ? 'Importa' : 'Aggiorna'}</button>` : ''}</td></tr>`;
  }).join('') || msg('Nessuna riga in questa sezione');
  const imp = list.filter((r) => IMPORTABILI.has(r.stato));
  $('#imp-all').checked = imp.length > 0 && imp.every((r) => sel.has(r.i));
  $('#imp-count').textContent = `${list.length} righe${list.length > SHOW_MAX ? ` · mostrate le prime ${SHOW_MAX}: usa la ricerca per trovarne altre (“seleziona tutte” vale su tutte)` : ''}`;
  aggiornaBottone();
}
function aggiornaBottone() {
  const b = $('#imp-go');
  b.disabled = !sel.size;
  b.textContent = sel.size ? `Importa selezionati (${sel.size})` : 'Importa selezionati';
}

async function importa(ids) {
  const scelte = ids.map((i) => rows.find((r) => r.i === i)).filter((r) => r && IMPORTABILI.has(r.stato));
  if (!scelte.length) return;
  const nuovi = scelte.filter((r) => r.stato === 'nuovo');
  const agg = scelte.filter((r) => r.stato === 'diverso');
  const testo = [nuovi.length && `inserire <b>${nuovi.length}</b> ${nuovi.length === 1 ? 'abbonamento nuovo' : 'abbonamenti nuovi'}`,
    agg.length && `aggiornare <b>${agg.length}</b> ${agg.length === 1 ? 'abbonamento esistente' : 'abbonamenti esistenti'}`].filter(Boolean).join(' e ');
  if (!(await deps.askConfirm(`Vuoi ${testo}?<br><span style="font-size:12.5px">I soci coinvolti vengono segnati col badge UP.</span>`, 'Importa'))) return;
  const btn = $('#imp-go'); btn.disabled = true;
  let ok = 0, ko = 0;
  try {
    const res = await applica(await getSupa(), scelte, (n, tot) => { btn.textContent = `Aggiornamento ${n}/${tot}…`; });
    ({ ok, ko } = res);
    res.errori.forEach((m) => console.error(m));
  } catch (err) { deps.toast(`Errore import: ${err.message || err}`, 'warn'); }
  deps.toast(ko ? `Importati ${ok}, errori ${ko} (dettagli in console)` : `Importati ${ok} abbonamenti`, ko ? 'warn' : 'ok');
  await analizza();      // ricalcola gli stati: le righe importate diventano "Già presente"
  deps.onDone?.();
}

export function renderImporta() { render(); }
