// Cruscotto "Import abbonamenti" (visibile a tutti gli utenti staff).
// Legge i file DBF del vecchio gestionale (scelti da Esplora risorse, vedi legacydbf.js)
// oppure abbonamenti.csv prodotto da tools/import-legacy/dbf_to_csv.py, e li confronta col DB.
// Scrive SOLO sulla tabella abbonamenti: non crea né modifica soci, piani o pagamenti.
//   - socio collegato via soci.cod_cli, piano via piani.nome
//   - stesso socio + piano + data_inizio = stesso abbonamento (niente doppioni)
//   - righe importabili una a una o in blocco, sempre dopo conferma
import { getSupa, fetchAll } from './data.js?v=__BUILD__';
import { abbonamentiDaDbf } from './legacydbf.js?v=__BUILD__';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHOW_MAX = 300;   // righe disegnate in tabella (la selezione vale su tutte le righe filtrate)
const CHUNK = 500;

const STATI = {
  nuovo: ['Nuovo', 'g'], diverso: ['Diverso', 'w'], presente: ['Già presente', 'n'],
  nosocio: ['Socio mancante', 'b'], nopiano: ['Piano mancante', 'b'],
};
const IMPORTABILI = new Set(['nuovo', 'diverso']);

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
const nz = (v) => (v && v.trim() !== '' ? v.trim() : null);
const dz = (v) => { const s = nz(v); return s && s >= '1900-01-01' && s < '2900-01-01' ? s : null; };
const addMonths = (iso, m) => { const d = new Date(iso); d.setMonth(d.getMonth() + (m || 1)); return d.toISOString().slice(0, 10); };
const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString('it-IT') : '—');

let deps = {};            // { toast, askConfirm, onDone }
let csvRows = null;       // righe grezze del CSV
let rows = [];            // righe analizzate
const sel = new Set();    // indici selezionati
const state = { filtro: 'importabili', query: '', soloCorrenti: true };

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
  const socioBy = new Map(soci.map((s) => [String(s.cod_cli).trim(), s]));
  const pianoBy = new Map(piani.map((p) => [p.nome, p]));
  const abbBy = new Map();   // socio|piano -> abbonamenti esistenti
  for (const a of abb) {
    const k = `${a.socio_id}|${a.piano_id}`;
    (abbBy.get(k) || abbBy.set(k, []).get(k)).push(a);
  }
  const today = new Date().toISOString().slice(0, 10);
  const src = state.soloCorrenti ? csvRows.filter((a) => a.is_latest === '1') : csvRows;

  const visti = new Set();   // righe doppie nel CSV: si importa solo la prima
  rows = src.map((a, i) => {
    const s = socioBy.get(String(a.cod_cli).trim());
    const p = pianoBy.get(a.piano_nome);
    const r = { i, cod: a.cod_cli, piano: a.piano_nome, socio: s ? `${s.cognome} ${s.nome}` : '' };
    if (!s) return { ...r, stato: 'nosocio' };
    if (!p) return { ...r, stato: 'nopiano' };
    // stessi calcoli di tools/import-legacy/import.mjs
    const inizioCsv = dz(a.data_inizio);
    const inizio = inizioCsv || today;
    const scad = dz(a.data_scadenza) || addMonths(inizio, p.durata_mesi || 1);
    const entrate = nz(a.entrate_residue) ? Number(a.entrate_residue) : (p.entrate > 0 ? p.entrate : null);
    const stato = a.disabilitato === 'true' ? 'disdetto' : (scad < today ? 'scaduto' : 'attivo');
    const nuovo = { socio_id: s.id, piano_id: p.id, data_inizio: inizio, data_scadenza: scad, entrate_residue: entrate, stato };
    const esist = abbBy.get(`${s.id}|${p.id}`) || [];
    // con data_inizio nel CSV si cerca lo stesso inizio; senza, l'ultimo abbonamento di quel piano
    const ex = inizioCsv ? esist.find((x) => x.data_inizio === inizioCsv)
      : esist.sort((x, y) => (x.data_scadenza < y.data_scadenza ? 1 : -1))[0];
    const chiave = `${s.id}|${p.id}|${inizio}`;
    if (!ex && visti.has(chiave)) return { ...r, stato: 'presente', nuovo, dup: true };
    visti.add(chiave);
    if (!ex) return { ...r, stato: 'nuovo', nuovo };
    const diff = {};
    if (ex.data_scadenza !== scad) diff.data_scadenza = scad;
    if ((ex.entrate_residue ?? null) !== entrate) diff.entrate_residue = entrate;
    if (ex.stato !== 'archiviato' && ex.stato !== stato) diff.stato = stato;   // gli archiviati restano archiviati
    if (!Object.keys(diff).length) return { ...r, stato: 'presente', nuovo, ex };
    return { ...r, stato: 'diverso', nuovo, ex, diff };
  });
  sel.clear();
  render();
}

function filtrate() {
  const q = state.query.trim().toLowerCase();
  return rows.filter((r) => {
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
  const cnt = (s) => rows.filter((r) => r.stato === s).length;
  document.querySelectorAll('#imp-filtri .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.f === state.filtro);
    const n = c.dataset.f === 'tutti' ? rows.length : c.dataset.f === 'importabili' ? cnt('nuovo') + cnt('diverso') : cnt(c.dataset.f);
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
  if (!(await deps.askConfirm(`Vuoi ${testo}?<br><span style="font-size:12.5px">Le anagrafiche dei soci non vengono toccate.</span>`, 'Importa'))) return;
  const btn = $('#imp-go'); btn.disabled = true;
  let ok = 0, ko = 0;
  try {
    const supa = await getSupa();
    for (let k = 0; k < nuovi.length; k += CHUNK) {
      const part = nuovi.slice(k, k + CHUNK);
      const { error } = await supa.from('abbonamenti').insert(part.map((r) => r.nuovo));
      if (error) { ko += part.length; console.error(error.message); } else ok += part.length;
    }
    for (const r of agg) {
      btn.textContent = `Aggiornamento ${ok + ko + 1}/${scelte.length}…`;
      const { error } = await supa.from('abbonamenti').update(r.diff).eq('id', r.ex.id);
      if (error) { ko++; console.error(error.message); } else ok++;
    }
  } catch (err) { deps.toast(`Errore import: ${err.message || err}`, 'warn'); }
  deps.toast(ko ? `Importati ${ok}, errori ${ko} (dettagli in console)` : `Importati ${ok} abbonamenti`, ko ? 'warn' : 'ok');
  await analizza();      // ricalcola gli stati: le righe importate diventano "Già presente"
  deps.onDone?.();
}

export function renderImporta() { render(); }
