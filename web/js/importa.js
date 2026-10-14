// Cruscotto "Import abbonamenti" (visibile a tutti gli utenti staff).
// Legge i file DBF del vecchio gestionale (scelti da Esplora risorse, vedi legacydbf.js)
// oppure abbonamenti.csv prodotto da tools/import-legacy/dbf_to_csv.py, e li confronta col DB.
// Scrive sulla tabella abbonamenti: non crea soci o piani; per gli abbonamenti nuovi e recenti
// crea un pagamento "da verificare" al prezzo del piano (vedi importlogic.js). Sui soci toccati
// valorizza solo soci.aggiornato_da_import (badge "UP" nelle anagrafiche).
//   - socio collegato via soci.cod_cli, piano via piani.nome
//   - stesso socio + piano + data_inizio = stesso abbonamento (niente doppioni)
//   - righe importabili una a una o in blocco, sempre dopo conferma
import { getSupa, fetchAll } from './data.js?v=__BUILD__';
import { abbonamentiDaDbf } from './legacydbf.js?v=__BUILD__';
import { confronta, applica, registra, IMPORTABILI, indiceCandidati, nomeSocio, SENZA_SCADENZA, GIORNI_PAGAMENTO } from './importlogic.js?v=__BUILD__';

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
const fmtD = (iso) => (!iso ? '—' : iso >= SENZA_SCADENZA ? 'senza scadenza' : new Date(iso).toLocaleDateString('it-IT'));

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
  $('#reg-periodo').addEventListener('change', (e) => {
    reg.periodo = e.target.value;
    $('#reg-da').hidden = $('#reg-a').hidden = reg.periodo !== 'custom';
    caricaRegistro();
  });
  ['#reg-da', '#reg-a'].forEach((id) => $(id).addEventListener('change', () => caricaRegistro()));
  $('#reg-azioni').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    reg.azione = c.dataset.a; renderRegistro();
  });
  $('#ver-table tbody').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ver]'); if (b) gestisci(b.dataset.ver, daVer[+b.dataset.i]);
  });
}

// confronta il CSV col DB (solo letture)
async function analizza() {
  $('#imp-table tbody').innerHTML = msg('Confronto col database in corso…');
  const supa = await getSupa();
  const [soci, piani, abb] = await Promise.all([
    fetchAll(supa, 'soci', 'id,cod_cli,nome,cognome,codice_fiscale'),
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
    return !q || `${r.cod} ${r.socio} ${r.vecchio} ${r.anag?.cf || ''} ${r.piano}`.toLowerCase().includes(q);
  });
}

const msg = (t) => `<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:28px">${t}</td></tr>`;
const val = (k, v) => (k === 'data_scadenza' ? fmtD(v) : v ?? '—');
function dettaglio(r) {
  const periodo = `${fmtD(r.inizioFile)} → ${r.scadFile ? fmtD(r.scadFile) : 'senza scadenza'}`;
  if (r.stato === 'nosocio') {
    const g = r.anag, dati = [g.nascita && `nato/a il ${fmtD(g.nascita)}`, g.cf && `CF ${g.cf}`, g.telefono && `tel. ${g.telefono}`, g.email, g.citta].filter(Boolean).map(esc).join(' · ');
    return `Nessun socio con questo codice cliente: il socio non viene creato<br>Vecchio gestionale: <b>${esc(r.vecchio || 'nome non disponibile')}</b>${dati ? ` · ${dati}` : ''} · ${periodo}`
      + (r.candidato ? `<br>Possibile socio in GymIN: <b>${esc(r.candidato)}</b>` : '');
  }
  if (r.stato === 'nopiano') return `Piano inesistente in GymIN: crealo prima in Abbonamenti<br>${periodo}`;
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
      <td class="mono">${esc(r.cod)}</td><td>${r.socio ? esc(r.socio) : r.vecchio ? `<i title="Nome dal vecchio gestionale: non presente in GymIN">${esc(r.vecchio)}</i>` : '—'}</td><td><span class="plan-pill">${esc(r.piano)}</span></td>
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
  if (!(await deps.askConfirm(`Vuoi ${testo}?<br><span style="font-size:12.5px">I soci coinvolti vengono segnati col badge UP.${nuovi.length ? `<br>Per gli abbonamenti nuovi iniziati negli ultimi ${GIORNI_PAGAMENTO} giorni viene creato un pagamento <b>da verificare</b> al prezzo del piano.` : ''}</span>`, 'Importa'))) return;
  const btn = $('#imp-go'); btn.disabled = true;
  let ok = 0, ko = 0, pag = 0;
  try {
    const res = await applica(await getSupa(), scelte, (n, tot) => { btn.textContent = `Aggiornamento ${n}/${tot}…`; });
    ({ ok, ko } = res); pag = res.pagamenti;
    res.errori.forEach((m) => console.error(m));
  } catch (err) { deps.toast(`Errore import: ${err.message || err}`, 'warn'); }
  deps.toast(ko ? `Importati ${ok}, errori ${ko} (dettagli in console)` : `Importati ${ok} abbonamenti${pag ? ` · ${pag} ${pag === 1 ? 'pagamento' : 'pagamenti'} da verificare` : ''}`, ko ? 'warn' : 'ok');
  await analizza();      // ricalcola gli stati: le righe importate diventano "Già presente"
  caricaRegistro().catch(() => {});
  deps.onDone?.();
}

export function renderImporta() {
  render();
  caricaDaVerificare().catch((err) => console.error(err.message || err));
  caricaRegistro().catch((err) => console.error(err.message || err));
}

// ---- Registro delle importazioni (tabella import_log, scritta da importlogic.js) ----
const reg = { periodo: 'ultimo', azione: '', righe: [] };
const giorno = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const piuGiorni = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function intervallo() {   // [da, a) in ISO; null = nessun limite
  const oggi = giorno(new Date());
  if (reg.periodo === 'oggi') return [oggi, null];
  if (reg.periodo === 'ieri') return [piuGiorni(oggi, -1), oggi];
  if (reg.periodo === '7' || reg.periodo === '30') return [piuGiorni(oggi, 1 - Number(reg.periodo)), null];
  const da = $('#reg-da').value, a = $('#reg-a').value;   // 'custom': date incluse
  return [da ? giorno(da) : null, a ? piuGiorni(giorno(a), 1) : null];
}
async function caricaRegistro() {
  const supa = await getSupa();
  let q = supa.from('import_log').select('creato_il,import_id,fonte,azione,cod_cli,socio,piano,prima,dopo');
  if (reg.periodo === 'ultimo') {
    const { data, error } = await supa.from('import_log').select('import_id').order('creato_il', { ascending: false }).limit(1);
    if (error) { $('#reg-box').hidden = true; return; }   // tabella assente (migration non applicata)
    q = q.eq('import_id', data[0]?.import_id ?? '');
  } else {
    const [da, a] = intervallo();
    if (da) q = q.gte('creato_il', da.toISOString());
    if (a) q = q.lt('creato_il', a.toISOString());
  }
  const { data, error } = await q.order('creato_il', { ascending: false }).order('id', { ascending: false }).limit(3000);
  if (error) { $('#reg-box').hidden = true; return; }
  $('#reg-box').hidden = false;
  reg.righe = data;
  renderRegistro();
}
const AZIONI = {
  nuovo: ['Nuovo', 'g'], aggiornato: ['Aggiornato', 'w'], socio_importato: ['Socio importato', 'g'], socio_collegato: ['Socio collegato', 'n'],
};
const regFiltro = (r) => !reg.azione || (reg.azione === 'socio' ? r.azione.startsWith('socio') : r.azione === reg.azione);
function dettaglioReg(r) {
  const lab = { data_scadenza: 'Scadenza', entrate_residue: 'Entrate', stato: 'Stato', data_inizio: 'Inizio' };
  const v = (k, x) => esc(k === 'data_scadenza' || k === 'data_inizio' ? fmtD(x) : x ?? '—');
  if (r.azione === 'aggiornato') return Object.keys(r.dopo || {}).map((k) => `${lab[k] || k}: ${v(k, r.prima?.[k])} → <b>${v(k, r.dopo[k])}</b>`).join('<br>');
  if (r.azione === 'nuovo' && r.dopo) {
    const d = r.dopo;
    return `${fmtD(d.data_inizio)} → ${fmtD(d.data_scadenza)}${d.entrate_residue != null ? ` · ${esc(d.entrate_residue)} entrate` : ''} · ${esc(d.stato)}`;
  }
  if (r.azione === 'socio_importato') return 'Creato con i dati del vecchio gestionale';
  if (r.azione === 'socio_collegato') return 'Codice cliente assegnato al socio già presente';
  return '';
}
function renderRegistro() {
  const tutte = reg.righe;
  document.querySelectorAll('#reg-azioni .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.a === reg.azione);
    const a = c.dataset.a;
    c.querySelector('span').textContent = ` ${tutte.filter((r) => !a || (a === 'socio' ? r.azione.startsWith('socio') : r.azione === a)).length}`;
  });
  const list = tutte.filter(regFiltro);
  const ora = (iso) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#reg-table tbody').innerHTML = list.slice(0, SHOW_MAX).map((r) => {
    const [lab, cls] = AZIONI[r.azione] || [r.azione, 'n'];
    return `<tr><td class="mono" style="white-space:nowrap">${ora(r.creato_il)}</td><td>${r.fonte === 'automatico' ? 'Automatico' : 'Manuale'}</td>
      <td>${esc(r.socio || '—')}<br><span style="font-size:12px;color:var(--ink-3)">cod. ${esc(r.cod_cli || '—')}</span></td>
      <td>${r.piano ? `<span class="plan-pill">${esc(r.piano)}</span>` : '—'}</td><td><span class="tag ${cls}">${lab}</span></td>
      <td style="font-size:12.5px">${dettaglioReg(r)}</td></tr>`;
  }).join('') || msg('Nessuna importazione in questo periodo');
  const quando = reg.periodo === 'ultimo' && tutte[0] ? ` · ultimo import del ${ora(tutte.at(-1).creato_il)} (${tutte[0].fonte})` : '';
  $('#reg-count').textContent = `${list.length} righe${quando}${list.length > SHOW_MAX ? ` · mostrate le prime ${SHOW_MAX}` : ''}`;
}

// ---- Soci da verificare: tabella soci_da_importare, riempita ogni mattina da auto-import.mjs ----
// Soci del vecchio gestionale senza corrispondenza in GymIN (soci.cod_cli). Lo staff li importa
// con l'anagrafica del vecchio gestionale, li collega al socio GymIN già presente o li ignora.
let daVer = [];      // righe ancora da verificare
let verSoci = [];    // soci GymIN, per proporre il collegamento (stesso CF o cognome+nome)

// numero di soci da verificare (contatore sul menu); 0 se la migration non è applicata
export async function contaDaVerificare() {
  const supa = await getSupa();
  const { count, error } = await supa.from('soci_da_importare').select('cod_cli', { count: 'exact', head: true }).eq('stato', 'da_verificare');
  return error ? 0 : count || 0;
}

async function caricaDaVerificare() {
  const supa = await getSupa();
  const { data, error } = await supa.from('soci_da_importare').select('cod_cli,dati,abbonamento,rilevato_il')
    .eq('stato', 'da_verificare').order('rilevato_il').order('cod_cli');
  if (error) { $('#ver-box').hidden = true; return; }   // tabella assente (migration non applicata)
  verSoci = data.length ? await fetchAll(supa, 'soci', 'id,cod_cli,nome,cognome,codice_fiscale') : [];
  daVer = data;
  renderDaVerificare();
  deps.onConta?.(data.length);
}

const candidatoDi = (v) => indiceCandidati(verSoci)({ cf: v.dati.codice_fiscale, nominativo: nomeSocio(v.dati) });
const scadenza = (a) => (a.data_scadenza && a.data_scadenza < '2900-01-01' ? fmtD(a.data_scadenza) : 'senza scadenza');

function renderDaVerificare() {
  $('#ver-box').hidden = !daVer.length;
  $('#ver-n').textContent = daVer.length;
  const grigio = (t) => `<span style="font-size:12px;color:var(--ink-3)">${t}</span>`;
  $('#ver-table tbody').innerHTML = daVer.map((v, i) => {
    const d = v.dati, a = v.abbonamento || {}, c = candidatoDi(v);
    const luogo = [d.indirizzo, d.cap, d.citta, d.provincia && `(${d.provincia})`].filter(Boolean).join(' ');
    const dati = [d.data_nascita && `nato/a il ${fmtD(d.data_nascita)}`, d.codice_fiscale && `CF ${d.codice_fiscale}`,
      d.telefono && `tel. ${d.telefono}`, d.email, luogo].filter(Boolean).map(esc).join('<br>');
    const abb = a.piano_nome ? `<span class="plan-pill">${esc(a.piano_nome)}</span>${a.data_inizio ? `<br>${fmtD(a.data_inizio)} → ${scadenza(a)}` : ''}` : '—';
    const gym = c ? `${esc(nomeSocio(c))}<br>${grigio(c.cod_cli ? `già collegato al cod. ${esc(c.cod_cli)}` : 'senza codice cliente')}` : grigio('Nessuna corrispondenza');
    const btn = (az, t) => `<button class="btn-ghost btn-xs" data-ver="${az}" data-i="${i}">${t}</button>`;
    return `<tr><td class="mono">${esc(v.cod_cli)}</td><td><b>${esc(nomeSocio(d))}</b><br>${grigio(`rilevato il ${fmtD(v.rilevato_il)}`)}</td>
      <td style="font-size:12.5px">${dati || '—'}</td><td style="font-size:12.5px">${abb}</td><td style="font-size:12.5px">${gym}</td>
      <td style="white-space:nowrap">${c && !c.cod_cli ? `${btn('collega', 'Collega')} ` : ''}${btn('importa', 'Importa')} ${btn('ignora', 'Ignora')}</td></tr>`;
  }).join('');
}

async function gestisci(azione, v) {
  if (!v) return;
  const d = v.dati, c = candidatoDi(v), nome = `<b>${esc(nomeSocio(d))}</b>`;
  const conAbb = v.abbonamento?.piano_nome ? ' e il suo abbonamento' : '';
  const testo = {
    importa: `Creare il socio ${nome} (cod. ${esc(v.cod_cli)}) con i dati del vecchio gestionale${conAbb}?`
      + (c ? `<br><span style="font-size:12.5px">Attenzione: in GymIN c'è già <b>${esc(nomeSocio(c))}</b>, controlla che non sia un doppione.</span>` : ''),
    collega: `Collegare <b>${esc(nomeSocio(c || d))}</b> di GymIN al codice cliente ${esc(v.cod_cli)} del vecchio gestionale${conAbb ? ` e importare il suo abbonamento` : ''}?`
      + '<br><span style="font-size:12.5px">I dati anagrafici in GymIN non cambiano.</span>',
    ignora: `Ignorare ${nome}? Non comparirà più tra i soci da verificare.`,
  }[azione];
  if (!(await deps.askConfirm(testo, { importa: 'Importa', collega: 'Collega', ignora: 'Ignora' }[azione]))) return;
  try {
    const supa = await getSupa();
    let esito = `${nomeSocio(d)} ignorato`;
    if (azione !== 'ignora') {
      const cols = 'id,cod_cli,nome,cognome';
      let socio, nota = '';
      if (azione === 'collega') {
        if (!c || c.cod_cli) return;
        const { data, error } = await supa.from('soci').update({ cod_cli: v.cod_cli }).eq('id', c.id).select(cols).single();
        if (error) throw error;
        socio = data;
      } else {
        let { data, error } = await supa.from('soci').insert({ ...d, cod_cli: v.cod_cli }).select(cols).single();
        if (error && d.email && /email/i.test(error.message)) {   // email già usata da un altro socio: si importa senza
          ({ data, error } = await supa.from('soci').insert({ ...d, email: null, cod_cli: v.cod_cli }).select(cols).single());
          nota = ' · email già usata da un altro socio, non importata';
        }
        if (error) throw error;
        socio = data;
      }
      esito = `${nomeSocio(socio)} ${azione === 'collega' ? 'collegato' : 'importato'}${await importaAbbonamento(supa, socio, v)}${nota}`;
    }
    const { error } = await supa.from('soci_da_importare')
      .update({ stato: azione === 'ignora' ? 'ignorato' : 'importato', gestito_il: new Date().toISOString() }).eq('cod_cli', v.cod_cli);
    if (error) throw error;
    if (azione !== 'ignora') {
      await registra(supa, [{ azione: azione === 'collega' ? 'socio_collegato' : 'socio_importato', cod_cli: v.cod_cli,
        socio: nomeSocio(azione === 'collega' ? c : d), piano: v.abbonamento?.piano_nome || null }]);
    }
    deps.toast(esito, 'ok');
  } catch (err) { deps.toast(`Errore: ${err.message || err}`, 'warn'); }
  await caricaDaVerificare();
  caricaRegistro().catch(() => {});
  if (azione !== 'ignora') deps.onDone?.();
}

// abbonamento corrente del socio appena importato/collegato, con le regole dell'import
async function importaAbbonamento(supa, socio, v) {
  const a = v.abbonamento;
  if (!a?.piano_nome) return '';
  const [piani, abb] = await Promise.all([
    fetchAll(supa, 'piani', 'id,nome,durata_mesi,entrate'),
    fetchAll(supa, 'abbonamenti', 'id,socio_id,piano_id,data_inizio,data_scadenza,entrate_residue,stato', (q) => q.eq('socio_id', socio.id)),
  ]);
  const [r] = confronta([{ ...a, cod_cli: v.cod_cli, is_latest: '1' }], { soci: [socio], piani, abb });
  if (r.stato === 'nopiano') return ` · piano "${a.piano_nome}" non presente in GymIN: abbonamento non importato`;
  if (!IMPORTABILI.has(r.stato)) return '';
  const { ko, errori, pagamenti } = await applica(supa, [r]);
  if (ko) throw new Error(`socio salvato, abbonamento no: ${errori.join('; ')}`);
  return ` · abbonamento importato${pagamenti ? ' · pagamento da verificare' : ''}`;
}
