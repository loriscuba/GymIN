import { loadData, getSupa, fetchAll, PLAN_COLORS } from './data.js?v=__BUILD__';
import { templates } from './mailtemplates.js?v=__BUILD__';
import {
  loadInformative, informativaAttiva, loadEventi, registraEventi, eventiDaModulo, eventoRevoca,
  schedaPrivacyHtml, storicoHtml, informativaHtml, moduloSocioHtml, privacyFromRow,
} from './privacy.js?v=__BUILD__';

const $ = (s, r = document) => r.querySelector(s);
const euro = (n) => '€ ' + Math.round(n).toLocaleString('it-IT');
// Nessun dato personale (email, telefono) nei log o nei messaggi di errore.
const redact = (v) => String(v ?? '').replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]').replace(/\+?\d[\d\s.-]{7,}\d/g, '[tel]');
const errMsg = (err) => redact(err?.message || err);
const fmtDate = (d) => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
const initials = (n) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const AV = ['#f4511e', '#2563eb', '#0d9488', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#4f46e5'];

let DATA = null;
const MAILBOX = [];
const reminded = new Set();
const memState = { filter: 'Attivo', query: '', page: 1, PER: 9, expWindow: 7, sort: null };   // sort: null | 'asc' | 'desc' (scadenza)
let planFilter = 'attivo';
let socioMode = 'new';
let editSid = null;
let expWindow = 7;   // fascia "in scadenza" della dashboard: 7 / 15 / 30
// fasce giorni alla scadenza: 7 = 0–7, 15 = 8–15, 30 = 16–31
const EXP_BANDS = { 7: [0, 7], 15: [8, 15], 30: [16, 31] };
const inExpBand = (dleft, w) => { const [lo, hi] = EXP_BANDS[w]; return dleft >= lo && dleft <= hi; };
const expBandLabel = (w) => { const [lo, hi] = EXP_BANDS[w]; return lo ? `tra ${lo} e ${hi} giorni` : `entro ${hi} giorni`; };
// soci con abbonamento a tempo nella fascia expWindow (esclude i carnet, che sono a consumo)
const expiringList = () => DATA.members.filter((m) => m.end && !m.plan.entrate && inExpBand(m.dleft, expWindow)).sort((a, b) => a.dleft - b.dleft);

const ic = {
  euro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7a7 7 0 1 0 0 10M5 10h8M5 14h8"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
};

// ---------- helpers di stato ----------
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const giorniTo = (d) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(d) - t) / 86400000); };
const statoDa = (dleft) => (dleft < 0 ? 'Scaduto' : dleft <= 31 ? 'In scadenza' : 'Attivo');
// stato che tiene conto dei carnet a consumo
const computeStato = (m) => m.plan.entrate ? (m.entrateResidue <= 0 ? 'Scaduto' : m.entrateResidue <= 1 ? 'In scadenza' : 'Attivo') : statoDa(m.dleft);
// testo colonna "Scadenza": data per gli abbonamenti a tempo, entrate residue per i carnet
const scadCell = (m) => m.stato === 'Senza abbonamento' || !m.end ? '<span style="color:var(--ink-3)">—</span>' : m.plan.entrate ? `${m.entrateResidue}/${m.plan.entrate} entrate` : fmtDate(m.end);
function nextTessera() {
  const nums = DATA.members.map((m) => +(String(m.id).match(/(\d+)/)?.[1] || 0));
  return 'GY-' + (Math.max(1200, ...nums) + 1);
}
function recomputePlans() {
  for (const p of DATA.plans) {
    const list = DATA.members.filter((m) => m.plan.name === p.name);
    p.count = list.length;
    p.active = list.filter((m) => m.stato === 'Attivo').length;
  }
}

// ---------- toast ----------
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<span class="ti">${kind === 'warn' ? ic.alert : kind === 'mail' ? ic.mail : ic.check}</span><span>${msg}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

// conferma non bloccante in basso a destra (sostituisce window.confirm, che su iPad/PWA può non aprirsi)
function askConfirm(msg, okLabel = 'Conferma', icon = ic.mail) {
  return new Promise((resolve) => {
    const t = document.createElement('div');
    t.className = 'toast ask'; t.setAttribute('role', 'alertdialog');
    t.innerHTML = `<span class="ti">${icon}</span><span>${msg}</span><div class="tact"><button type="button" class="btn-ghost" data-a="0">Annulla</button><button type="button" class="btn-sm" data-a="1">${okLabel}</button></div>`;
    const done = (v) => { t.classList.add('out'); setTimeout(() => t.remove(), 300); resolve(v); };
    t.addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b) done(b.dataset.a === '1'); });
    $('#toasts').appendChild(t);
    t.querySelector('[data-a="1"]').focus();
  });
}

// ---------- tooltip istantaneo (data-tip) ----------
const tipEl = document.createElement('div');
tipEl.className = 'tip'; tipEl.hidden = true;
document.body.appendChild(tipEl);
function showTip(el) {
  // niente tooltip sulle voci di menu: al passaggio del mouse la barra si espande e mostra le etichette
  if (el.classList.contains('nav')) return;
  const txt = el.getAttribute('data-tip'); if (!txt) return;
  tipEl.textContent = txt; tipEl.hidden = false;
  const r = el.getBoundingClientRect();
  const below = r.top < 46;
  tipEl.dataset.pos = below ? 'below' : 'above';
  tipEl.style.left = (r.left + r.width / 2) + 'px';
  tipEl.style.top = (below ? r.bottom + 8 : r.top - 8) + 'px';
}
const hideTip = () => { tipEl.hidden = true; };
document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
document.addEventListener('mouseout', (e) => { const el = e.target.closest('[data-tip]'); if (el && !el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('click', hideTip, true);
window.addEventListener('scroll', hideTip, true);

// ---------- rendering base ----------
function sparkline(data, color) {
  const w = 82, h = 34, mx = Math.max(...data), mn = Math.min(...data);
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 6)]);
  const d = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d} L${w},${h} L0,${h} Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pts.at(-1)[0].toFixed(1)}" cy="${pts.at(-1)[1].toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}
function kpi(label, icon, bg, col, val, trend, tclass, spark) {
  return `<div class="kpi"><div class="klabel"><span class="kbadge" style="background:${bg};color:${col}">${icon}</span>${label}</div>
    <div class="kval num">${val}</div><div class="ktrend"><span class="${tclass}">${trend}</span></div>${spark || ''}</div>`;
}
const tagFor = (s) => s === 'Attivo' ? '<span class="tag g">Attivo</span>' : s === 'In scadenza' ? '<span class="tag w">In scadenza</span>' : s === 'Senza abbonamento' ? '<span class="tag n">Senza abbonamento</span>' : '<span class="tag b">Scaduto</span>';
const who = (m) => `<div class="who" data-member="${m.sid}" role="button" tabindex="0" data-tip="Apri scheda socio"><div class="av" style="background:${m.av}">${initials(m.nome)}</div><div><b>${m.nome}</b><span>${m.id}</span></div></div>`;
const zapSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>';
const refreshSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';
const mailSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
const cardSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>';
const trashSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
const editSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
// stessi pulsanti-icona usati sia in tabella sia nella scheda socio
const actionIcons = (m) => `<button class="ibtn edit" data-edit="${m.sid}" data-tip="Modifica dati" aria-label="Modifica dati">${editSvg}</button><button class="ibtn remind" data-remind="${m.sid}" data-tip="Invia promemoria" aria-label="Invia promemoria">${mailSvg}</button><button class="ibtn quick" data-quickrenew="${m.sid}" data-tip="Rinnovo rapido · mantiene il piano" aria-label="Rinnovo rapido">${zapSvg}</button><button class="ibtn full" data-renew="${m.sid}" data-tip="Rinnova · scegli il piano" aria-label="Rinnova con opzioni">${refreshSvg}</button><button class="ibtn pay" data-payments="${m.sid}" data-tip="Visualizza pagamenti" aria-label="Visualizza pagamenti">${cardSvg}</button>`;
const actionsCell = (m) => `<td><div class="actions-cell">${actionIcons(m)}</div></td>`;

function renderDashboard() {
  const { revenue } = DATA;
  const members = DATA.members.filter((m) => m.stato !== 'Senza abbonamento');
  const plans = DATA.plans.filter((p) => p.attivo !== false);
  const attivi = members.filter((m) => m.stato === 'Attivo');
  const scad = members.filter((m) => m.stato === 'In scadenza');
  const scaduti = members.filter((m) => m.stato === 'Scaduto');
  const rev = revenue.map((r) => r.value);
  const cur = rev.at(-1), prev = rev.at(-2) || cur;
  const growth = prev ? ((cur - prev) / prev * 100) : 0;

  $('#kpis').innerHTML =
    kpi('Fatturato (mese)', ic.euro, 'var(--accent-soft)', 'var(--accent-ink)', euro(cur), `${growth >= 0 ? '↑' : '↓'} ${Math.abs(growth).toFixed(1)}% vs mese prec.`, growth >= 0 ? 'trend-up' : 'trend-dn', sparkline(rev.slice(6), 'var(--accent)')) +
    kpi('Contratti attivi', ic.users, 'var(--good-bg)', 'var(--good)', attivi.length, `${(attivi.length / members.length * 100).toFixed(0)}% dei soci`, 'trend-up', '') +
    kpi('In scadenza (31gg)', ic.alert, 'var(--warn-bg)', 'var(--warn)', scad.length, 'Da contattare per rinnovo', '', '') +
    kpi('Contratti scaduti', ic.door, 'var(--bad-bg)', 'var(--bad)', scaduti.length, 'Recuperabili con win-back', '', '');

  const pmax = Math.max(...plans.map((p) => p.count), 1);
  $('#distchart').innerHTML = plans.map((p) => `<div class="distrow"><span class="dl">${p.name}</span><div class="track"><div class="fill" style="width:${(p.count / pmax * 100).toFixed(0)}%;background:${p.color}"></div></div><span class="dv">${p.count} soci</span></div>`).join('');

  $('#contractsplit').innerHTML =
    `<div class="statbox"><div class="s1"><i style="background:var(--good)"></i>Attivi</div><div class="s2 num" style="color:var(--good)">${attivi.length}</div><div class="s3">${(attivi.length / members.length * 100).toFixed(0)}% del totale</div></div>` +
    `<div class="statbox"><div class="s1"><i style="background:var(--bad)"></i>Scaduti</div><div class="s2 num" style="color:var(--bad)">${scaduti.length}</div><div class="s3">Tasso abbandono ${(scaduti.length / members.length * 100).toFixed(0)}%</div></div>`;
  const tot = members.length;
  $('#contractbar').innerHTML = `<div style="display:flex;height:100%;width:100%">
    <div style="width:${attivi.length / tot * 100}%;background:var(--good)"></div>
    <div style="width:${scad.length / tot * 100}%;background:var(--warn)"></div>
    <div style="width:${scaduti.length / tot * 100}%;background:var(--bad)"></div></div>`;

  const expAll = expiringList();
  const exp = expAll.slice(0, 12);
  $('#exp-title').textContent = `In scadenza ${expBandLabel(expWindow)}`;
  $('#exp-sub').textContent = `${expAll.length} ${expAll.length === 1 ? 'socio' : 'soci'} · da contattare per il rinnovo`;
  document.querySelectorAll('#exp-filters .chip').forEach((c) => c.classList.toggle('active', +c.dataset.w === expWindow));
  $('#expiring tbody').innerHTML = exp.map((m) => `<tr><td>${who(m)}</td><td><span class="plan-pill">${m.plan.name}</span></td><td class="mono">${fmtDate(m.end)} <span style="color:var(--warn);font-weight:600">· ${m.dleft}gg</span></td><td class="mono">${euro(m.plan.price)}</td>${actionsCell(m)}</tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:20px">Nessun socio in scadenza ${expBandLabel(expWindow)}</td></tr>`;
}

function renderMembers() {
  const list = DATA.members.filter((m) => {
    const mf = memState.filter === 'all' || (memState.filter === 'In scadenza' && m.end && !m.plan.entrate
      ? inExpBand(m.dleft, memState.expWindow)
      : m.stato === memState.filter);
    const q = (memState.query || '').toLowerCase();
    const nome = (m.nome || '').toLowerCase();
    const email = (m.email || '').toLowerCase();
    const id = String(m.id || '').toLowerCase();
    const mailQuery = !q || nome.includes(q) || email.includes(q) || id.includes(q);
    return mf && mailQuery;
  });
  if (memState.sort) {                         // ordina per scadenza; soci senza scadenza sempre in fondo
    const dir = memState.sort === 'asc' ? 1 : -1;
    const t = (m) => (m.stato !== 'Senza abbonamento' && m.end ? new Date(m.end).getTime() : null);
    list.sort((a, b) => { const x = t(a), y = t(b); return x === null ? (y === null ? 0 : 1) : y === null ? -1 : (x - y) * dir; });
  }
  $('#sort-scad').textContent = memState.sort === 'asc' ? ' ▲' : memState.sort === 'desc' ? ' ▼' : ' ⇅';
  const pages = Math.max(1, Math.ceil(list.length / memState.PER));
  if (memState.page > pages) memState.page = pages;
  const slice = list.slice((memState.page - 1) * memState.PER, memState.page * memState.PER);
  $('#memtable tbody').innerHTML = slice.map((m) => `<tr><td>${who(m)}</td><td class="mono">${m.id}</td><td><span class="plan-pill">${m.plan.name}</span></td><td class="mono">${fmtDate(m.start)}</td><td class="mono">${scadCell(m)}</td><td>${tagFor(m.stato)}</td>${actionsCell(m)}</tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:28px">Nessun socio trovato</td></tr>';
  $('#memcount').textContent = `${list.length} soci · pagina ${memState.page} di ${pages}`;
  let pg = `<button ${memState.page === 1 ? 'disabled' : ''} data-p="prev">‹</button>`;
  for (let i = 1; i <= pages && i <= 6; i++) pg += `<button class="${i === memState.page ? 'active' : ''}" data-p="${i}">${i}</button>`;
  pg += `<button ${memState.page === pages ? 'disabled' : ''} data-p="next">›</button>`;
  $('#mempager').innerHTML = pg;
}

function renderPlans() {
  const { plans } = DATA;
  const list = plans.filter((p) => {
    if (planFilter === 'attivo') return p.attivo !== false;
    if (planFilter === 'disattivo') return p.attivo === false;
    return true;
  });

  $('#plans').innerHTML = list.map((p) => `<div class="plancard${p.name === 'Annuale' ? ' feat' : ''}">${p.name === 'Annuale' ? '<div class="ribbon">Più venduto</div>' : ''}
    <h3>${p.name}</h3><div class="price num">${euro(p.price)}</div>
    <div class="sub-metric"><span>Soci attivi</span><b class="num">${p.active} / ${p.count}</b></div>
    <div class="sub-metric"><span>Durata</span><b>${p.dur} ${p.dur === 1 ? 'mese' : 'mesi'}</b></div>
    ${p.entrate ? `<div class="sub-metric"><span>Entrate</span><b>${p.entrate} ticket</b></div>` : ''}
    ${!p.attivo ? `<div class="sub-metric"><span>Stato</span><b style="color:var(--warn)">Disattivo</b></div>` : ''}
    <div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn-row" data-plan-edit="${p.id || p.name}">Modifica</button></div>
    </div>`).join('') || '<div style="grid-column:1/-1;text-align:center;color:var(--ink-3);padding:28px;border:1px dashed var(--line);border-radius:12px">Nessun piano trovato per questo filtro.</div>';

  const mrr = plans.filter((p) => planFilter === 'all' || (planFilter === 'attivo' ? p.attivo !== false : p.attivo === false ? false : true)).map((p) => ({ p, v: p.active * p.mcost }));
  const tot = mrr.reduce((a, b) => a + b.v, 0), mx = Math.max(...mrr.map((m) => m.v), 1);
  $('#mrr-tot').textContent = 'MRR totale: ' + euro(tot);
  $('#mrrchart').innerHTML = mrr.map((m) => `<div class="distrow"><span class="dl">${m.p.name}</span><div class="track"><div class="fill" style="width:${(m.v / mx * 100).toFixed(0)}%;background:${m.p.color}"></div></div><span class="dv">${euro(m.v)}</span></div>`).join('') || '<div style="padding:14px 0;color:var(--ink-3)">Nessun dato per il filtro attuale.</div>';
}

function renderAccessi() {
  const acc = DATA.accessi;
  const ok = acc.filter((a) => a.ok).length;
  $('#acckpis').innerHTML =
    kpi('Accessi oggi', ic.door, 'var(--accent-soft)', 'var(--accent-ink)', acc.length, 'Ingressi registrati', '', '') +
    kpi('Validati', ic.check, 'var(--good-bg)', 'var(--good)', ok, `${acc.length ? (ok / acc.length * 100).toFixed(0) : 0}% senza anomalie`, 'trend-up', '') +
    kpi('Negati', ic.alert, 'var(--bad-bg)', 'var(--bad)', acc.length - ok, 'Abbonamento scaduto', '', '');
  $('#acctable tbody').innerHTML = acc.map((a) => `<tr><td class="mono" style="font-weight:600">${a.time}</td><td><div class="who"><div class="av" style="background:${a.av}">${initials(a.nome)}</div><div><b>${a.nome}</b><span>${a.id}</span></div></div></td><td><span class="plan-pill">${a.plan}</span></td><td class="mono">${a.ing}</td><td>${a.ok ? (a.warnScad ? '<span class="tag w">Valido · in scadenza</span>' : '<span class="tag g">Valido</span>') : '<span class="tag b">Negato</span>'}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:24px">Nessun accesso oggi</td></tr>';
}

function renderPosta() {
  $('#c-posta').textContent = MAILBOX.length || '';
  $('#posta tbody').innerHTML = MAILBOX.map((m, i) => `<tr data-i="${i}" style="cursor:pointer"><td class="mono">${m.when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td><td><span class="plan-pill">${m.tipoLabel}</span></td><td><b>${m.nome}</b><br><span style="color:var(--ink-3);font-size:12px">${m.destinatario}</span></td><td>${m.subject}</td><td>${m.channel === 'real' ? '<span class="tag g">Reale</span>' : m.channel === 'mailpit' ? '<span class="tag g">Mailpit</span>' : '<span class="tag w">Anteprima</span>'}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:28px">Nessuna mail inviata. Aggiungi un socio o invia i promemoria di rinnovo.</td></tr>';
}

async function canManagePlans() {
  const supa = await getSupa();
  if (!supa) return false;
  const { data: { user }, error } = await supa.auth.getUser();
  if (error || !user) return false;
  return (user.app_metadata?.role === 'admin') || (user.user_metadata?.role === 'admin');
}

function renderAll() {
  $('#c-mem').textContent = DATA.members.length;
  $('#c-acc').textContent = DATA.accessi.length;
  renderDashboard(); renderMembers(); renderPlans(); renderAccessi(); renderPosta();
}

// ---------- CONFIG RUNTIME / SETTINGS ----------
// ambiente di test (stesso dominio della produzione): impostazioni salvate a parte, mai mescolate
const SETTINGS_STORAGE_KEY = window.GYMIN_CONFIG?.ENV === 'test' ? 'gymin-settings-test' : 'gymin-settings';

function loadSettingsFromStorage() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function applyStoredConfig() {
  const stored = loadSettingsFromStorage();
  const base = window.GYMIN_CONFIG || {};
  window.GYMIN_CONFIG = { ...base, ...stored };
}
function saveSettingsToStorage(next) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  window.GYMIN_CONFIG = { ...(window.GYMIN_CONFIG || {}), ...next };
}
function resetSettingsToDefault() {
  try { localStorage.removeItem(SETTINGS_STORAGE_KEY); } catch {}
  const base = window.GYMIN_CONFIG || {};
  window.GYMIN_CONFIG = { ...base };
  populateSettingsForm();
  toast('Impostazioni ripristinate ai valori di default', 'warn');
}
function populateSettingsForm() {
  const cfg = { ...(window.GYMIN_CONFIG || {}), ...loadSettingsFromStorage() };
  $('#s-mailpit-url').value = cfg.MAILPIT_URL || '';
  $('#s-mailer-api-url').value = cfg.MAILER_API_URL || '';
  $('#s-mailer-api-key').value = cfg.MAILER_API_KEY || '';
}
function openSettingsModal() {
  populateSettingsForm();
  openModal('modal-settings');
}
function saveSettingsFromModal(e) {
  e.preventDefault();
  const form = {
    MAILPIT_URL: $('#s-mailpit-url').value.trim(),
    MAILER_API_URL: $('#s-mailer-api-url').value.trim(),
    MAILER_API_KEY: $('#s-mailer-api-key').value.trim(),
  };
  saveSettingsToStorage(form);
  closeModal('modal-settings');
  toast('Impostazioni email salvate nel browser', 'mail');
}

applyStoredConfig();

// ---------- MAIL ----------
async function toMailpit(mail) {
  const url = window.GYMIN_CONFIG && window.GYMIN_CONFIG.MAILPIT_URL;
  if (!url) return false;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/api/v1/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ From: { Email: 'no-reply@gymin.local', Name: 'GymIN' }, To: [{ Email: mail.destinatario }], Subject: mail.subject, HTML: mail.html }),
    });
    return r.ok;
  } catch { return false; }
}
let selectedMailIndex = 0;

async function sendMail({ tipo, tipoLabel, member, subject, html }) {
  const mail = { tipo, tipoLabel, nome: member.nome, destinatario: member.email, subject, html, when: new Date(), channel: 'preview' };
  if (await toMailpit(mail)) mail.channel = 'mailpit';
  MAILBOX.unshift(mail);
  selectedMailIndex = 0;
  renderPosta();
  return mail;
}
async function sendRealMail() {
  const cfg = window.GYMIN_CONFIG || {};
  const url = cfg.MAILER_API_URL;
  const mail = MAILBOX[selectedMailIndex] || MAILBOX[0];
  if (!url) { toast('Configura MAILER_API_URL in config.js per usare il canale reale.', 'warn'); return; }
  if (!mail) { toast('Nessuna mail in coda da inviare.', 'warn'); return; }

  try {
    const headers = buildMailerHeaders(cfg);
    const r = await fetch(url.replace(/\/$/, ''), {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: mail.destinatario, subject: mail.subject, html: mail.html, tipo: mail.tipo, rif: `${mail.tipo}:${Date.now()}` }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Invio reale non riuscito');
    mail.channel = 'real';
    renderPosta();
    toast(`Email reale inviata a ${mail.destinatario}`, 'mail');
  } catch (err) {
    toast(err.message || 'Invio reale fallito', 'error');
  }
}
function clearPosta() {
  if (!MAILBOX.length) { toast('La posta è già vuota', 'warn'); return; }
  MAILBOX.length = 0;
  reminded.clear();
  renderPosta();
  toast('Posta svuotata');
}
function openMailPreview(i) {
  const m = MAILBOX[i]; if (!m) return;
  selectedMailIndex = i;
  $('#mail-subject').textContent = m.subject;
  $('#mail-to').textContent = m.destinatario;
  $('#mailframe').srcdoc = m.html;
  openModal('modal-mail');
}
async function sendReminderTo(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  if (!m.email) { toast('Il socio non ha un indirizzo email', 'warn'); return; }
  if (!(await askConfirm(`Inviare 1 mail di promemoria a <b>${m.nome}</b> (${m.email})?`, 'Invia'))) return;
  const { subject, html } = templates.rinnovo(m, Math.max(0, m.dleft));
  const mail = await sendMail({ tipo: 'rinnovo', tipoLabel: 'Rinnovo', member: m, subject, html });
  reminded.add(m.sid);
  toast(mail.channel === 'mailpit' ? `Promemoria inviato a Mailpit · ${m.email}` : `Promemoria generato (anteprima) · ${m.nome}`, 'mail');
}
async function sendReminders() {
  const list = expiringList().filter((m) => m.email && !reminded.has(m.sid));
  if (!list.length) { toast('Nessun nuovo promemoria da inviare', 'warn'); return; }
  if (!(await askConfirm(`Stai per inviare <b>${list.length}</b> mail di promemoria. Confermi?`, 'Invia'))) return;
  for (const m of list) {
    const { subject, html } = templates.rinnovo(m, Math.max(0, m.dleft));
    await sendMail({ tipo: 'rinnovo', tipoLabel: 'Rinnovo', member: m, subject, html });
    reminded.add(m.sid);
  }
  const real = !!(window.GYMIN_CONFIG && window.GYMIN_CONFIG.MAILPIT_URL);
  toast(`${list.length} promemoria di rinnovo ${real ? 'inviati a Mailpit' : 'generati (anteprima)'}`, 'mail');
}

// ---------- MODALI ----------
function openModal(id) { $('#' + id).hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(id) { $('#' + id).hidden = true; document.body.style.overflow = ''; }

function openSocioModal(mode = 'new', sid = null) {
  if (!DATA || !Array.isArray(DATA.plans) || !Array.isArray(DATA.members)) {
    toast('Dati non ancora pronti: aspetta il caricamento dell’anagrafica.', 'warn');
    return;
  }
  socioMode = mode; editSid = sid;
  $('#socioform').reset();
  socioError('');
  $('#socio-dup').hidden = true;
  $('#f-piano').innerHTML = DATA.plans.map((p) => `<option value="${p.name}">${p.name} — ${euro(p.price)} · ${p.dur} mese/i</option>`).join('');
  const isNew = mode === 'new';
  $('#socio-title').textContent = isNew ? 'Nuovo socio' : 'Modifica socio';
  $('#socio-sub').textContent = isNew ? 'Anagrafica + primo abbonamento' : 'Aggiorna i dati anagrafici';
  $('#socio-submit').textContent = isNew ? 'Aggiungi socio' : 'Salva modifiche';
  $('#socio-abbsection').hidden = !isNew;
  closeModal('modal-scheda');
  if (isNew) {
    $('#f-inizio').value = new Date().toISOString().slice(0, 10);
    $('#f-consenso').checked = true;
  } else {
    const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
    const set = (id, v) => { $(id).value = v || ''; };
    set('#f-nome', m.firstName || m.nome.split(' ')[0]);
    set('#f-cognome', m.lastName || m.nome.split(' ').slice(1).join(' '));
    set('#f-email', m.email); set('#f-tel', m.telefono);
    set('#f-sesso', m.sesso); set('#f-nascita', m.dataNascita); set('#f-cf', m.cf);
    set('#f-indirizzo', m.indirizzo); set('#f-citta', m.citta); set('#f-cap', m.cap);
    set('#f-note', m.note);
    $('#f-consenso').checked = !!m.consenso;
  }
  openModal('modal-socio');
  setTimeout(() => $('#f-nome').focus(), 50);
}
function readSocioForm() {
  const nome = $('#f-nome').value.trim(), cognome = $('#f-cognome').value.trim();
  return {
    firstName: nome, lastName: cognome, nome: `${nome} ${cognome}`,
    email: $('#f-email').value.trim().toLowerCase(), telefono: $('#f-tel').value.trim(),
    sesso: $('#f-sesso').value, dataNascita: $('#f-nascita').value, cf: $('#f-cf').value.trim().toUpperCase(),
    indirizzo: $('#f-indirizzo').value.trim(), citta: $('#f-citta').value.trim(), cap: $('#f-cap').value.trim(),
    note: $('#f-note').value.trim(), consenso: $('#f-consenso').checked,
  };
}

// ---------- Supabase: soci e abbonamenti ----------
// Nessuna funzione qui sovrascrive un socio esistente con i dati di un altro:
// se l'email è già usata si blocca e l'operatore sceglie dalla schermata "Record già presente".
async function findSocioByEmail(supa, email, excludeId = null) {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return null;
  let query = supa.from('soci').select('id,nome,cognome,email,tessera').eq('email', clean);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}
const emailTakenError = () => new Error('Record già presente: l’email indicata è già usata da un altro socio.');

const socioPayload = (f) => ({
  nome: f.firstName,
  cognome: f.lastName,
  email: f.email || null,
  telefono: f.telefono || null,
  data_nascita: f.dataNascita || null,
  sesso: f.sesso || null,
  codice_fiscale: f.cf || null,
  indirizzo: f.indirizzo || null,
  citta: f.citta || null,
  cap: f.cap || null,
  note: f.note || null,
  consenso_mail: !!f.consenso,
});

async function insertSocio(supa, f, tessera) {
  const taken = await findSocioByEmail(supa, f.email);
  if (taken) throw emailTakenError(taken);
  const { data, error } = await supa.from('soci').insert({ ...socioPayload(f), tessera: tessera || null }).select('id,tessera').single();
  if (error) throw error;
  return data;
}

async function updateSocio(supa, sid, f) {
  const taken = await findSocioByEmail(supa, f.email, sid);
  if (taken) throw emailTakenError(taken);
  const { error } = await supa.from('soci').update(socioPayload(f)).eq('id', sid);
  if (error) throw error;
}

// Nuovo abbonamento (+ pagamento) per un socio già salvato.
async function insertAbbonamento(supa, socioId, plan, start, end, metodo = 'contanti', importo = plan.price) {
  const planLookup = plan.id ? { key: 'id', value: plan.id } : { key: 'nome', value: plan.name };
  const { data: planRow, error: planErr } = await supa.from('piani').select('id').eq(planLookup.key, planLookup.value).maybeSingle();
  if (planErr) throw planErr;
  if (!planRow) throw new Error(`Piano non trovato in database: ${plan.name}`);

  const { data: ab, error: abbErr } = await supa.from('abbonamenti').insert({
    socio_id: socioId,
    piano_id: planRow.id,
    data_inizio: start.toISOString().slice(0, 10),
    data_scadenza: end.toISOString().slice(0, 10),
    entrate_residue: plan.entrate ? Number(plan.entrate) : null,
    stato: 'attivo',
  }).select('id').single();
  if (abbErr) throw abbErr;

  const { error: payErr } = await supa.from('pagamenti').insert({
    abbonamento_id: ab.id,
    socio_id: socioId,
    importo: Number(importo || 0),
    metodo: metodo || 'contanti',
    data: new Date().toISOString(),
  });
  if (payErr) throw payErr;
}

// ---------- validazione + controllo duplicati anagrafica ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// confronto "morbido": minuscolo, senza accenti/apostrofi, spazi compattati
const normName = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normTel = (v) => String(v || '').replace(/\D/g, '').replace(/^(0039|39)(?=3\d{8,9}$)/, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUP_LABEL = { email: 'stessa email', tel: 'stesso cellulare', nome: 'stesso nome e cognome' };

// Soci già presenti con stessa email, stesso telefono o stesso nome+cognome (anche invertiti).
// Ritorna [{ m, why: ['email'|'tel'|'nome', ...] }], prima i match per email.
function findDuplicates(f) {
  const n = normName(f.firstName), c = normName(f.lastName);
  const email = f.email.toLowerCase(), tel = normTel(f.telefono);
  const out = [];
  for (const m of DATA.members) {
    if (socioMode === 'edit' && m.sid === editSid) continue;
    const mn = normName(m.firstName ?? m.nome.split(' ')[0]), mc = normName(m.lastName ?? m.nome.split(' ').slice(1).join(' '));
    const why = [];
    if (email && (m.email || '').toLowerCase() === email) why.push('email');
    if (tel.length >= 6 && normTel(m.telefono) === tel) why.push('tel');
    if (n && c && ((mn === n && mc === c) || (mn === c && mc === n))) why.push('nome');
    if (why.length) out.push({ m, why });
  }
  return out.sort((x, y) => y.why.includes('email') - x.why.includes('email') || y.why.length - x.why.length);
}

// Avviso mentre si digita (solo informativo: la scelta si fa al salvataggio).
function renderDuplicates() {
  const box = $('#socio-dup');
  const d = findDuplicates(readSocioForm());
  if (!d.length) { box.hidden = true; box.innerHTML = ''; return d; }
  box.className = 'dupbox';
  box.innerHTML = `<b>Attenzione: ${d.length === 1 ? 'esiste già un socio simile' : `esistono già ${d.length} soci simili`}. Al salvataggio potrai scegliere se usare il record esistente.</b>
    <ul>${d.map(({ m, why }) => `<li><span>${esc(m.nome)} <small>· ${esc(m.id)} · ${why.map((w) => DUP_LABEL[w]).join(', ')}</small></span></li>`).join('')}</ul>`;
  box.hidden = false;
  return d;
}

function socioError(msg, fields = []) {
  ['#f-nome', '#f-cognome', '#f-tel', '#f-email'].forEach((id) => $(id).classList.toggle('invalid', fields.includes(id)));
  const el = $('#socio-err');
  el.textContent = msg || '';
  el.hidden = !msg;
  if (fields[0]) $(fields[0]).focus();
  return !msg;
}

// Regole: nome e cognome obbligatori; almeno uno tra telefono ed email; formati validi.
function validateSocio(f) {
  if (!f.firstName || !f.lastName) {
    return socioError('Nome e cognome sono obbligatori.', [!f.firstName && '#f-nome', !f.lastName && '#f-cognome'].filter(Boolean));
  }
  if (!f.telefono && !f.email) return socioError('Inserisci almeno un recapito: telefono oppure email.', ['#f-tel', '#f-email']);
  if (f.email && !EMAIL_RE.test(f.email)) return socioError('L\'indirizzo email non è valido.', ['#f-email']);
  if (f.telefono && normTel(f.telefono).length < 6) return socioError('Il numero di telefono non è valido.', ['#f-tel']);
  return socioError('');
}

// ---------- schermata "Record già presente" ----------
let pendingSocio = null;   // dati del modulo in attesa della scelta dell'operatore
function openDupModal(f, dups) {
  pendingSocio = f;
  const isNew = socioMode === 'new';
  const emailClash = dups.some((d) => d.why.includes('email'));
  const val = (v) => (v ? esc(v) : '<span style="color:var(--ink-3)">—</span>');
  const card = ({ m, why }) => {
    const hl = (k, v) => `<div class="${why.includes(k) ? 'hit' : ''}">${v}</div>`;
    return `<div class="dupcard">
      <div class="dupcard-head">
        <div class="av" style="background:${m.av}">${initials(m.nome)}</div>
        <div style="flex:1;min-width:0">${hl('nome', `<b>${esc(m.nome)}</b>`)}<small>Tessera ${esc(m.id)} · ${esc(m.stato)}${m.plan && m.plan.name !== '—' ? ' · ' + esc(m.plan.name) : ''}</small></div>
      </div>
      <div class="dupmatch">${why.map((w) => `<span class="tag w">${DUP_LABEL[w]}</span>`).join('')}</div>
      <dl class="dupdl">
        <dt>Email</dt><dd>${hl('email', val(m.email))}</dd>
        <dt>Cellulare</dt><dd>${hl('tel', val(m.telefono))}</dd>
        <dt>Data di nascita</dt><dd>${m.dataNascita ? esc(fmtDate(m.dataNascita)) : val('')}</dd>
        <dt>Codice fiscale</dt><dd>${val(m.cf)}</dd>
        <dt>Indirizzo</dt><dd>${val([m.indirizzo, m.cap, m.citta].filter(Boolean).join(', '))}</dd>
      </dl>
      <div class="dupcard-foot">${isNew
        ? `<button type="button" class="btn-primary" data-dup-use="${esc(m.sid)}">Sì, usa questo</button>`
        : `<button type="button" class="btn-ghost" data-dup-open="${esc(m.sid)}">Apri la sua scheda</button>`}</div>
    </div>`;
  };
  $('#modal-dup .modal').innerHTML = `
    <div class="mhead"><div><h3>Record già presente</h3><div class="msub">${isNew
      ? `Esiste già ${dups.length === 1 ? 'un socio' : 'più di un socio'} con questi dati. Vuoi usare questo?`
      : 'Questi dati corrispondono a un altro socio già registrato.'}</div></div><button type="button" class="xbtn" data-dup-back>×</button></div>
    <div class="mbody">
      ${dups.map(card).join('')}
      ${isNew ? `<p class="duphint">Scegliendo <b>“Sì, usa questo”</b> il record esistente <b>non viene modificato</b>: gli viene solo aggiunto l'abbonamento scelto (${esc($('#f-piano').value)}).</p>` : ''}
      ${emailClash ? `<p class="duphint bad">L'email <b>${esc(f.email)}</b> appartiene già a un altro socio: per ${isNew ? 'creare un socio diverso' : 'salvare'} torna al modulo e cambiala.</p>` : ''}
    </div>
    <div class="mfoot">
      <button type="button" class="btn-ghost" data-dup-back>Torna al modulo</button>
      ${emailClash ? '' : `<button type="button" class="btn-ghost" data-dup-force>${isNew ? 'No, crea un nuovo socio' : 'Salva comunque'}</button>`}
    </div>`;
  $('#modal-dup').hidden = false;
}
function closeDupModal() { $('#modal-dup').hidden = true; pendingSocio = null; }

async function submitSocio(e) {
  e.preventDefault();
  const f = readSocioForm();
  if (!validateSocio(f)) return;
  const dups = findDuplicates(f);
  if (dups.length) { openDupModal(f, dups); return; }
  await saveSocio(f);
}

function resetMemberList() {
  memState.filter = 'Attivo'; memState.query = ''; memState.page = 1;
  $('#memsearch').value = '';
  document.querySelectorAll('#memfilters .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === 'Attivo'));
  $('#mem-expfilters').hidden = true;
}
const formPlan = () => {
  const plan = DATA.plans.find((p) => p.name === $('#f-piano').value);
  const start = new Date($('#f-inizio').value || Date.now());
  return { plan, start, end: addMonths(start, plan.dur), metodo: $('#f-metodo').value };
};

async function saveSocio(f) {
  const supa = await getSupa();
  if (!supa) { toast('Connessione Supabase non disponibile. Verifica la configurazione del database.', 'warn'); return; }

  if (socioMode === 'edit') {
    const m = DATA.members.find((x) => x.sid === editSid); if (!m) return;
    try {
      await updateSocio(supa, m.sid, f);
    } catch (err) {
      console.error(errMsg(err));
      toast('Errore aggiornamento socio: ' + errMsg(err), 'warn');
      return;
    }
    Object.assign(m, f);
    renderAll();
    closeModal('modal-socio');
    toast(`Dati aggiornati · ${m.nome}`);
    openScheda(m.sid);
    return;
  }

  const { plan, start, end, metodo } = formPlan();
  const member = { ...f, id: nextTessera() };
  try {
    const row = await insertSocio(supa, f, member.id);
    await insertAbbonamento(supa, row.id, plan, start, end, metodo);
    member.sid = row.id;
    member.id = row.tessera || member.id;
    payCache = null;
    DATA = await loadData();
  } catch (err) {
    console.error(errMsg(err));
    toast('Errore inserimento socio: ' + errMsg(err), 'warn');
    return;
  }
  renderAll();
  closeModal('modal-socio');
  toast(`Socio ${member.nome} aggiunto · ${plan.name}`);
  if (member.consenso && member.email) {
    const { subject, html } = templates.benvenuto(member);
    const mail = await sendMail({ tipo: 'benvenuto', tipoLabel: 'Benvenuto', member, subject, html });
    toast(mail.channel === 'mailpit'
      ? `Mail di benvenuto inviata a Mailpit · ${member.email}`
      : `Mail di benvenuto generata (anteprima) · apri la sezione Posta`, 'mail');
  }
  resetMemberList();
  go('anagrafiche');
}

// "Sì, usa questo": il socio esistente resta com'è, riceve solo il nuovo abbonamento.
async function useExistingSocio(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  const supa = await getSupa();
  if (!supa) { toast('Connessione Supabase non disponibile. Verifica la configurazione del database.', 'warn'); return; }
  const { plan, start, end, metodo } = formPlan();
  try {
    await insertAbbonamento(supa, m.sid, plan, start, end, metodo);
    payCache = null;
    DATA = await loadData();
  } catch (err) {
    console.error(errMsg(err));
    toast('Errore creazione abbonamento: ' + errMsg(err), 'warn');
    $('#modal-dup').querySelectorAll('button').forEach((b) => { b.disabled = false; });
    return;
  }
  closeDupModal();
  closeModal('modal-socio');
  renderAll();
  toast(`Usato il socio esistente ${m.nome} · nuovo abbonamento ${plan.name}`);
  resetMemberList();
  go('anagrafiche');
  openScheda(m.sid);
}

// ---------- ricerca socio: campo di testo libero con i risultati sotto (al posto del menu a tendina) ----------
function socioPicker(key, onPick = () => {}) {
  const hid = $(`#${key}`), q = $(`#${key}-q`), res = $(`#${key}-res`);
  let hits = [], cur = 0;
  const draw = () => {
    res.innerHTML = hits.map((m, i) => `<button type="button" class="${i === cur ? 'on' : ''}" data-i="${i}"><b>${esc(m.nome)}</b><span>${esc(m.id)} · ${esc(m.stato)}</span></button>`).join('')
      || (q.value.trim() && !hid.value ? '<div class="none">Nessun socio trovato</div>' : '');
  };
  const pick = (m) => { hid.value = m ? m.sid : ''; q.value = m ? `${m.nome} — ${m.id}` : ''; hits = []; draw(); onPick(m); };
  q.addEventListener('input', () => {
    const had = hid.value; hid.value = '';
    const t = normName(q.value), d = q.value.replace(/\D/g, '');
    hits = !t ? [] : DATA.members.filter((m) => normName(`${m.nome} ${m.id} ${m.email || ''}`).includes(t)
      || (d.length >= 3 && normTel(m.telefono).includes(d))).slice(0, 8);
    cur = 0; draw();
    if (had) onPick(null);
  });
  q.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) { e.preventDefault(); cur = (cur + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; draw(); }
    else if (e.key === 'Enter' && hits.length) { e.preventDefault(); pick(hits[cur]); }
  });
  res.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(hits[+b.dataset.i]); } });
  return { set: (sid) => pick(DATA.members.find((m) => m.sid === sid) || null), focus: () => q.focus() };
}
let accPicker, payPicker;

function openAccessoModal() {
  accPicker.set(null);
  openModal('modal-accesso');
  accPicker.focus();
}
function submitAccesso(e) {
  e.preventDefault();
  const m = DATA.members.find((x) => x.sid === $('#a-socio').value);
  if (!m) { toast('Cerca e seleziona un socio', 'warn'); accPicker.focus(); return; }
  const isCarnet = !!m.plan.entrate;
  let ok, extra = '', motivo = 'abbonamento scaduto';
  if (isCarnet) {
    if ((m.entrateResidue || 0) <= 0) { ok = false; motivo = 'carnet esaurito'; }
    else {
      ok = true;
      m.entrateResidue -= 1;                       // consuma un'entrata dal carnet
      m.stato = computeStato(m);
      extra = ` · ${m.entrateResidue} ${m.entrateResidue === 1 ? 'entrata rimasta' : 'entrate rimaste'}`;
    }
  } else {
    ok = m.stato !== 'Scaduto';
  }
  const now = new Date();
  DATA.accessi.unshift({
    time: now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    nome: m.nome, id: m.id, av: m.av, plan: m.plan.name, ing: $('#a-ingresso').value,
    ok, warnScad: m.stato === 'In scadenza',
  });
  renderAll();                                     // aggiorna anche stato/entrate nelle altre viste
  closeModal('modal-accesso');
  toast(ok ? `Accesso registrato · ${m.nome}${extra}` : `Accesso NEGATO · ${m.nome} (${motivo})`, ok ? 'ok' : 'warn');
  if (!$('#modal-scheda').hidden && schedaSid === m.sid) openScheda(m.sid);
}

// ---------- rinnovo abbonamento ----------
let renewSid = null;
const ymd = (d) => new Date(d).toLocaleDateString('sv');   // YYYY-MM-DD in ora locale
// scadenza scelta a mano nel rinnovo (letta come le date del DB, così resta lo stesso giorno); null se non valida o passata
function forcedEnd(sel) {
  const v = $(sel).value; if (!v) return null;
  const d = new Date(v), t = new Date(); t.setHours(0, 0, 0, 0);
  return isNaN(d) || d < t ? null : d;
}
function renewBase(m) { const t = new Date(); t.setHours(0, 0, 0, 0); return new Date(m.end) >= t ? new Date(m.end) : t; }
function openRinnovoModal(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  renewSid = sid;
  closeModal('modal-scheda');
  $('#r-socio').textContent = `${m.nome} · ${m.id}`;
  $('#r-piano').innerHTML = DATA.plans.map((p) => `<option value="${p.name}"${p.name === m.plan.name ? ' selected' : ''}>${p.name} — ${euro(p.price)} · ${p.dur} mese/i</option>`).join('');
  $('#r-old').textContent = fmtDate(m.end);
  $('#r-metodo').value = 'contanti';
  updateRinnovoPreview();
  openModal('modal-rinnovo');
}
function updateRinnovoPreview() {
  const m = DATA.members.find((x) => x.sid === renewSid); if (!m) return;
  const plan = DATA.plans.find((p) => p.name === $('#r-piano').value);
  $('#r-new').value = ymd(addMonths(renewBase(m), plan.dur));
}
async function applyRenewal(m, plan, sendRicevuta, metodo = 'contanti', importo = plan.price, end = null) {
  const newEnd = end || addMonths(renewBase(m), plan.dur);
  const start = renewBase(m) > newEnd ? new Date() : renewBase(m);   // scadenza forzata prima della vecchia: parte da oggi
  const supa = await getSupa();
  if (!supa) { toast('Connessione Supabase non disponibile. Verifica la configurazione del database.', 'warn'); return false; }
  try {
    await insertAbbonamento(supa, m.sid, plan, start, newEnd, metodo, importo);
  } catch (err) {
    console.error(errMsg(err));
    toast('Errore rinnovo: ' + errMsg(err), 'warn');
    return false;
  }
  payCache = null;
  m.plan = { name: plan.name, price: plan.price, mcost: plan.mcost, dur: plan.dur, color: plan.color, entrate: plan.entrate };
  m.end = newEnd; m.dleft = giorniTo(newEnd);
  m.entrateResidue = plan.entrate ? plan.entrate : undefined;  // il carnet riparte pieno
  m.stato = computeStato(m);
  reminded.delete(m.sid);                       // riabilita eventuali futuri promemoria
  DATA.revenue.at(-1).value += Number(importo || 0);   // incassa la quota nel mese corrente
  recomputePlans();
  renderAll();
  toast(`Abbonamento rinnovato · ${m.nome} → scad. ${fmtDate(newEnd)} · ${metodoLabel(metodo)}`);
  if (sendRicevuta && m.email) {
    const { subject, html } = templates.ricevuta(m);
    const mail = await sendMail({ tipo: 'ricevuta', tipoLabel: 'Ricevuta', member: m, subject, html });
    toast(mail.channel === 'mailpit' ? `Ricevuta inviata a Mailpit · ${m.email}` : `Ricevuta generata (anteprima) · apri Posta`, 'mail');
  }
}
async function doRenew(e) {
  e.preventDefault();
  const m = DATA.members.find((x) => x.sid === renewSid); if (!m) return;
  const plan = DATA.plans.find((p) => p.name === $('#r-piano').value);
  const ricevuta = $('#r-ricevuta').checked;
  const end = forcedEnd('#r-new');
  if (!end) { toast('Scegli una data di scadenza valida (da oggi in poi)', 'warn'); return; }
  closeModal('modal-rinnovo');
  await applyRenewal(m, plan, ricevuta, $('#r-metodo').value, plan.price, end);
}
// rinnovo rapido: stesso piano, con ricevuta; chiede solo il tipo di pagamento
let quickSid = null, quickFromScheda = false;
function quickRenew(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  const plan = DATA.plans.find((p) => p.name === m.plan.name) || m.plan;
  if (!plan || plan.name === '—') { openRinnovoModal(sid); return; }   // senza piano: serve il rinnovo completo
  quickSid = sid;
  quickFromScheda = !$('#modal-scheda').hidden;
  closeModal('modal-scheda');
  $('#q-socio').textContent = `${m.nome} · ${m.id}`;
  $('#q-piano').textContent = `${plan.name} — ${euro(plan.price)}`;
  $('#q-new').value = ymd(addMonths(renewBase(m), plan.dur));
  $('#q-metodo').value = 'contanti';
  openModal('modal-quick');
}
async function doQuickRenew(e) {
  e.preventDefault();
  const m = DATA.members.find((x) => x.sid === quickSid); if (!m) return;
  const plan = DATA.plans.find((p) => p.name === m.plan.name) || m.plan;
  const end = forcedEnd('#q-new');
  if (!end) { toast('Scegli una data di scadenza valida (da oggi in poi)', 'warn'); return; }
  closeModal('modal-quick');
  await applyRenewal(m, plan, true, $('#q-metodo').value, plan.price, end);
  if (quickFromScheda) openScheda(m.sid);        // torna alla scheda aggiornata
}

// ---------- scheda socio ----------
let schedaSid = null;
function openScheda(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  schedaSid = sid;
  const row = (label, val) => `<div><span>${label}</span><b>${val || '—'}</b></div>`;
  const indirizzo = [m.indirizzo, [m.cap, m.citta].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  $('#modal-scheda .modal').innerHTML = `
    <div class="mhead"><div style="display:flex;align-items:center;gap:12px">
      <div class="av" style="width:46px;height:46px;background:${m.av};border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;font-size:15px">${initials(m.nome)}</div>
      <div><h3>${m.nome}</h3><div class="msub">${m.id} · ${m.plan.name}</div></div></div>
      <button type="button" class="xbtn" data-close="modal-scheda">×</button></div>
    <div class="mbody">
      <div style="margin-bottom:14px">${tagFor(m.stato)}</div>
      <div class="scheda-grid">
        ${row('Email', m.email)}
        ${row('Telefono', m.telefono)}
        ${row('Data di nascita', m.dataNascita ? fmtDate(m.dataNascita) : '')}
        ${row('Sesso', m.sesso)}
        ${row('Codice fiscale', m.cf)}
        ${row('Indirizzo', indirizzo)}
        ${row('Abbonamento', m.stato === 'Senza abbonamento' ? 'Nessun abbonamento' : `${m.plan.name} · ${euro(m.plan.price)}`)}
        ${row('Iscritto il', m.start ? fmtDate(m.start) : '')}
        ${m.stato === 'Senza abbonamento'
      ? row('Scadenza', '—')
      : m.plan.entrate
        ? row('Entrate residue', `${m.entrateResidue} / ${m.plan.entrate}`)
        : row('Scadenza', `${fmtDate(m.end)} · ${m.dleft >= 0 ? m.dleft + 'gg' : 'scaduto'}`)}
      </div>
      ${m.note ? `<div class="scheda-grid" style="grid-template-columns:1fr;margin-top:12px"><div><span>Note</span><b style="font-weight:500">${m.note}</b></div></div>` : ''}
      <div id="scheda-privacy">${schedaPrivacyHtml(m, null)}</div>
    </div>
    <div class="mfoot" style="justify-content:space-between;align-items:center">
      <button type="button" class="btn-ghost" data-close="modal-scheda">Chiudi</button>
      <div class="actions-cell">${actionIcons(m)}</div>
    </div>`;
  openModal('modal-scheda');
  hydratePrivacy(m);
}

// ---------- privacy socio ----------
async function hydratePrivacy(m) {
  const supa = await getSupa(); if (!supa) return;
  try {
    const [inf, eventi] = await Promise.all([loadInformative(supa), loadEventi(supa, m.sid)]);
    const box = $('#scheda-privacy'); if (!box || schedaSid !== m.sid) return;
    box.innerHTML = schedaPrivacyHtml(m, informativaAttiva(inf)?.versione);
    box.querySelector('.pv-histbody').innerHTML = storicoHtml(eventi);
  } catch (err) {
    console.error(errMsg(err));
    const h = $('#scheda-privacy .pv-histbody'); if (h) h.textContent = 'Storico non disponibile.';
  }
}
async function reloadSocioPrivacy(sid) {
  const supa = await getSupa();
  const { data, error } = await supa.from('soci').select('privacy_acknowledged,privacy_acknowledged_at,privacy_policy_version,marketing_email_consent,marketing_email_consent_at,marketing_email_revoked_at').eq('id', sid).single();
  if (error) throw error;
  const m = DATA.members.find((x) => x.sid === sid);
  if (m) Object.assign(m, privacyFromRow(data));
}
async function openInformativa(versione = null) {
  const supa = await getSupa(); if (!supa) return;
  try {
    const list = await loadInformative(supa);
    const body = $('#informativa-body');
    body.innerHTML = informativaHtml(list, versione);
    $('#inf-ver')?.addEventListener('change', (e) => openInformativa(e.target.value));
    openModal('modal-informativa');
  } catch (err) { console.error(errMsg(err)); toast('Informativa non disponibile: ' + errMsg(err), 'warn'); }
}
let privacySid = null, privacyVer = null;
async function openPrivacySocio(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  const supa = await getSupa(); if (!supa) return;
  try {
    const inf = informativaAttiva(await loadInformative(supa));
    if (!inf) { toast('Nessuna informativa pubblicata', 'warn'); return; }
    privacySid = sid; privacyVer = inf.versione;
    $('#privacy-socio-body').innerHTML = moduloSocioHtml(m, inf);
    openModal('modal-privacy-socio');
  } catch (err) { console.error(errMsg(err)); toast('Informativa non disponibile: ' + errMsg(err), 'warn'); }
}
async function submitPrivacySocio(e) {
  e.preventDefault();
  const m = DATA.members.find((x) => x.sid === privacySid); if (!m) return;
  const ack = $('#ps-ack'), mkt = $('#ps-mkt');
  const eventi = eventiDaModulo(m, privacyVer, { ack: ack.checked && !ack.disabled, marketing: mkt.checked && !mkt.disabled });
  if (!eventi.length) { toast('Nessuna nuova scelta da registrare', 'warn'); return; }
  try {
    const supa = await getSupa();
    await registraEventi(supa, m.sid, eventi);
    await reloadSocioPrivacy(m.sid);
  } catch (err) { console.error(errMsg(err)); toast('Errore registrazione privacy: ' + errMsg(err), 'warn'); return; }
  closeModal('modal-privacy-socio');
  toast('Scelte privacy registrate');
  openScheda(m.sid);
}
async function revocaMarketing(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m || !m.marketing?.consent) return;
  if (!(await askConfirm(`Registrare la revoca del consenso marketing email di <b>${m.nome}</b>?`, 'Revoca', ic.alert))) return;
  try {
    const supa = await getSupa();
    await registraEventi(supa, sid, [eventoRevoca()]);
    await reloadSocioPrivacy(sid);
  } catch (err) { console.error(errMsg(err)); toast('Errore revoca consenso: ' + errMsg(err), 'warn'); return; }
  toast('Consenso marketing revocato');
  openScheda(sid);
}

// ---------- pagamenti ----------
const METODI = { contanti: 'Contanti', bancomat: 'Bancomat', carta: 'Carta di credito', bonifico: 'Bonifico', satispay: 'Satispay', altro: 'Altro' };
const metodoLabel = (k) => METODI[k] || (k ? k[0].toUpperCase() + k.slice(1) : '—');
const payState = { period: 'mese', query: '', sid: null };
let payCache = null;   // { key, rows } — svuotata dopo ogni nuovo pagamento

function periodStart(period) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (period === 'oggi') return d;
  if (period === 'mese') return new Date(d.getFullYear(), d.getMonth(), 1);
  if (period === 'anno') return new Date(d.getFullYear(), 0, 1);
  return null;
}

async function loadPayments() {
  const key = `${payState.period}|${payState.sid || ''}`;
  if (!payCache || payCache.key !== key) {
    $('#paytable tbody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:28px">Caricamento…</td></tr>';
    try {
      const supa = await getSupa();
      if (!supa) throw new Error('Connessione Supabase non disponibile.');
      const from = periodStart(payState.period);
      const rows = await fetchAll(supa, 'pagamenti', 'id,importo,metodo,data,socio_id,descrizione,abbonamento_id,abbonamento:abbonamenti(socio_id,data_scadenza,piano:piani(nome))', (q) => {
        if (from) q = q.gte('data', from.toISOString());
        if (payState.sid) q = q.eq('socio_id', payState.sid);
        return q.order('data', { ascending: false });
      });
      if (key !== `${payState.period}|${payState.sid || ''}`) return;   // filtro cambiato nel frattempo
      payCache = { key, rows };
    } catch (err) {
      console.error(errMsg(err));
      $('#paytable tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--bad);padding:28px">Errore caricamento pagamenti: ${esc(errMsg(err))}</td></tr>`;
      return;
    }
  }
  renderPayments();
}

function renderPayments() {
  const bySid = Object.fromEntries(DATA.members.map((m) => [m.sid, m]));
  const q = normName(payState.query);
  const list = (payCache?.rows || []).map((p) => {
    const m = bySid[p.socio_id || p.abbonamento?.socio_id];
    return { ...p, m, nome: m ? m.nome : '—', tessera: m ? String(m.id) : '', piano: p.descrizione || p.abbonamento?.piano?.nome || '—' };
  }).filter((p) => !q || normName(`${p.nome} ${p.tessera} ${p.piano} ${metodoLabel(p.metodo)}`).includes(q));

  const tot = list.reduce((sum, p) => sum + Number(p.importo || 0), 0);
  const perMetodo = {};
  for (const p of list) perMetodo[p.metodo] = (perMetodo[p.metodo] || 0) + Number(p.importo || 0);
  const eur2 = (n) => '€ ' + Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $('#paysum').innerHTML = `<div class="pbox"><span>Totale incassato</span><b>${eur2(tot)}</b></div><div class="pbox"><span>Pagamenti</span><b>${list.length}</b></div>`
    + Object.entries(perMetodo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="pbox"><span>${esc(metodoLabel(k))}</span><b>${eur2(v)}</b></div>`).join('');

  const fmtDT = (d) => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#paytable tbody').innerHTML = list.map((p) => `<tr><td class="mono">${fmtDT(p.data)}</td><td>${p.m ? `<a role="button" style="cursor:pointer;font-weight:600" data-member="${esc(p.m.sid)}">${esc(p.nome)}</a>` : '—'}</td><td class="mono">${esc(p.tessera)}</td><td><span class="plan-pill">${esc(p.piano)}</span></td><td>${esc(metodoLabel(p.metodo))}</td><td class="mono" style="text-align:right">${eur2(p.importo)}</td><td><div class="actions-cell"><button class="ibtn edit" data-payedit="${esc(p.id)}" data-tip="Modifica pagamento" aria-label="Modifica pagamento">${editSvg}</button><button class="ibtn del" data-paydel="${esc(p.id)}" data-tip="Annulla pagamento" aria-label="Annulla pagamento">${trashSvg}</button></div></td></tr>`).join('')
    || '<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:28px">Nessun pagamento nel periodo selezionato</td></tr>';
  $('#paycount').textContent = `${list.length} ${list.length === 1 ? 'pagamento' : 'pagamenti'}`;

  const m = payState.sid && bySid[payState.sid];
  $('#payfor').hidden = !payState.sid;
  $('#payfor').innerHTML = m ? `Socio: ${esc(m.nome)} ✕` : '';
  document.querySelectorAll('#payfilters .chip').forEach((c) => c.classList.toggle('active', c.dataset.p === payState.period));
}

// "Visualizza pagamenti" dalla lista soci: apre la sezione filtrata su quel socio (tutto lo storico).
function openPayments(sid) {
  closeModal('modal-scheda');
  payState.sid = sid; payState.period = 'tutti'; payState.query = '';
  $('#paysearch').value = '';
  go('pagamenti');
}

// ---------- modifica / annulla pagamento ----------
let payEditId = null;
const payById = (id) => (payCache?.rows || []).find((p) => p.id === id);
const payLabel = (p) => {
  const m = DATA.members.find((x) => x.sid === (p.socio_id || p.abbonamento?.socio_id));
  return `${m ? m.nome : 'Senza socio'} · ${p.descrizione || p.abbonamento?.piano?.nome || '—'}`;
};
// dopo una modifica: ricarica dati (incassi dashboard, scadenze) e lista pagamenti
async function refreshAfterPayChange() {
  payCache = null;
  try { DATA = await loadData(); renderAll(); } catch (err) { console.error(errMsg(err)); }
  loadPayments();
}
function openPayEdit(id) {
  const p = payById(id); if (!p) return;
  payEditId = id;
  $('#pe-sub').textContent = payLabel(p);
  $('#pe-importo').value = Number(p.importo || 0).toFixed(2);
  $('#pe-metodo').value = METODI[p.metodo] ? p.metodo : 'altro';
  $('#pe-data').value = new Date(p.data).toLocaleDateString('sv');
  $('#pe-descr').value = p.descrizione || '';
  openModal('modal-payedit');
}
async function submitPayEdit(e) {
  e.preventDefault();
  const p = payById(payEditId); if (!p) return;
  const importo = Number(String($('#pe-importo').value).replace(',', '.'));
  const giorno = $('#pe-data').value;
  if (!(importo > 0)) { toast('Inserisci un importo valido', 'warn'); return; }
  if (!giorno) { toast('Inserisci la data del pagamento', 'warn'); return; }
  const patch = { importo, metodo: $('#pe-metodo').value, descrizione: $('#pe-descr').value.trim() || null };
  // la data cambia solo se è stato scelto un altro giorno (così resta l'orario originale)
  if (giorno !== new Date(p.data).toLocaleDateString('sv')) patch.data = new Date(giorno + 'T12:00:00').toISOString();
  const supa = await getSupa();
  if (!supa) { toast('Connessione Supabase non disponibile. Verifica la configurazione del database.', 'warn'); return; }
  const { error } = await supa.from('pagamenti').update(patch).eq('id', p.id);
  if (error) { console.error(errMsg(error)); toast('Errore modifica pagamento: ' + errMsg(error), 'warn'); return; }
  closeModal('modal-payedit');
  toast(`Pagamento modificato · ${euro(importo)} · ${metodoLabel(patch.metodo)}`);
  await refreshAfterPayChange();
}
function openPayDel(id) {
  const p = payById(id); if (!p) return;
  payEditId = id;
  const eur2 = (n) => '€ ' + Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $('#pd-info').innerHTML = `<div class="renew-info"><div><span>Pagamento</span><b>${esc(payLabel(p))}</b></div><div><span>Importo</span><b>${eur2(p.importo)} · ${esc(metodoLabel(p.metodo))}</b></div></div>`;
  // pagamento di un rinnovo: si può annullare anche l'abbonamento creato (es. rinnovo fatto per errore)
  $('#pd-abb-box').hidden = !p.abbonamento_id;
  $('#pd-abb').checked = false;
  if (p.abbonamento_id) $('#pd-abb-label').textContent = `Annulla anche l’abbonamento collegato (${p.abbonamento?.piano?.nome || 'piano'}${p.abbonamento?.data_scadenza ? ' · scad. ' + fmtDate(p.abbonamento.data_scadenza) : ''})`;
  openModal('modal-paydel');
}
async function submitPayDel(e) {
  e.preventDefault();
  const p = payById(payEditId); if (!p) return;
  const conAbb = !!p.abbonamento_id && $('#pd-abb').checked;
  const supa = await getSupa();
  if (!supa) { toast('Connessione Supabase non disponibile. Verifica la configurazione del database.', 'warn'); return; }
  // eliminando l'abbonamento si eliminano anche i suoi pagamenti (on delete cascade)
  const { error } = conAbb
    ? await supa.from('abbonamenti').delete().eq('id', p.abbonamento_id)
    : await supa.from('pagamenti').delete().eq('id', p.id);
  if (error) { console.error(errMsg(error)); toast('Errore annullamento: ' + errMsg(error), 'warn'); return; }
  closeModal('modal-paydel');
  toast(conAbb ? 'Pagamento e abbonamento annullati' : 'Pagamento annullato', 'warn');
  await refreshAfterPayChange();
}

// ---------- registra pagamento diretto ----------
// Abbonamento: se "Già utilizzato" registra solo l'incasso (socio che si era dimenticato di pagare),
// altrimenti attiva/rinnova l'abbonamento come il rinnovo. Prezzo libero: solo incasso (es. entrata libera).
function openPagamentoModal() {
  $('#p-piano').innerHTML = DATA.plans.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} — ${euro(p.price)}</option>`).join('');
  $('#p-tipo').value = 'abbonamento';
  $('#p-usato').checked = true;
  $('#p-descr').value = 'Entrata libera';
  $('#p-metodo').value = 'contanti';
  $('#p-data').value = new Date().toLocaleDateString('sv');
  payPicker.set(payState.sid);                 // richiama onPagamentoSocio
  openModal('modal-pagamento');
  if (!payState.sid) payPicker.focus();
}
// socio scelto: preseleziona il suo piano attuale
function onPagamentoSocio() {
  const m = DATA.members.find((x) => x.sid === $('#p-socio').value);
  if (m && DATA.plans.some((p) => p.name === m.plan.name)) $('#p-piano').value = m.plan.name;
  onPagamentoPiano();
}
function onPagamentoPiano() {
  const plan = DATA.plans.find((p) => p.name === $('#p-piano').value);
  if (plan && $('#p-tipo').value === 'abbonamento') $('#p-importo').value = Number(plan.price || 0).toFixed(2);
  updatePagamentoForm();
}
function updatePagamentoForm() {
  const abb = $('#p-tipo').value === 'abbonamento';
  const attiva = abb && !$('#p-usato').checked;
  $('#p-abb-box').hidden = !abb;
  $('#p-libero-box').hidden = abb;
  $('#p-data-box').hidden = attiva;             // il rinnovo incassa sempre alla data odierna
  const m = DATA.members.find((x) => x.sid === $('#p-socio').value);
  const plan = DATA.plans.find((p) => p.name === $('#p-piano').value);
  $('#p-hint').innerHTML = !abb ? 'Registra solo l’incasso, senza abbonamento.'
    : !attiva ? 'Registra solo l’incasso: <b>nessun abbonamento viene attivato</b>.'
      : m && plan ? `Attiva l’abbonamento: nuova scadenza <b>${fmtDate(addMonths(renewBase(m), plan.dur))}</b>.`
        : 'Per attivare un abbonamento seleziona un socio.';
}
async function submitPagamento(e) {
  e.preventDefault();
  const abb = $('#p-tipo').value === 'abbonamento';
  const m = DATA.members.find((x) => x.sid === $('#p-socio').value) || null;
  const plan = abb ? DATA.plans.find((p) => p.name === $('#p-piano').value) : null;
  const importo = Number(String($('#p-importo').value).replace(',', '.'));
  const metodo = $('#p-metodo').value;
  if (!m && $('#p-socio-q').value.trim()) { toast('Seleziona il socio dalla ricerca, oppure svuota il campo per un’entrata libera', 'warn'); return; }
  if (!(importo > 0)) { toast('Inserisci un importo valido', 'warn'); return; }
  if (abb && !plan) { toast('Seleziona un abbonamento', 'warn'); return; }

  if (abb && !$('#p-usato').checked) {
    if (!m) { toast('Seleziona il socio a cui attivare l’abbonamento', 'warn'); return; }
    closeModal('modal-pagamento');
    await applyRenewal(m, plan, false, metodo, importo);
    loadPayments();
    return;
  }

  const supa = await getSupa();
  if (!supa) { toast('Connessione Supabase non disponibile. Verifica la configurazione del database.', 'warn'); return; }
  const giorno = $('#p-data').value;
  const today = new Date().toLocaleDateString('sv');
  const data = !giorno || giorno === today ? new Date() : new Date(giorno + 'T12:00:00');
  const descrizione = abb ? `${plan.name} · già utilizzato` : ($('#p-descr').value.trim() || 'Entrata libera');
  const { error } = await supa.from('pagamenti').insert({
    abbonamento_id: null, socio_id: m ? m.sid : null, importo, metodo, descrizione, data: data.toISOString(),
  });
  if (error) { console.error(errMsg(error)); toast('Errore registrazione pagamento: ' + errMsg(error), 'warn'); return; }
  closeModal('modal-pagamento');
  const now = new Date();
  if (data.getFullYear() === now.getFullYear() && data.getMonth() === now.getMonth()) { DATA.revenue.at(-1).value += importo; renderAll(); }
  payCache = null;
  loadPayments();
  toast(`Pagamento registrato · ${m ? m.nome : descrizione} · ${euro(importo)} · ${metodoLabel(metodo)}`);
}

// ---------- log attività (tabella audit_log, scritta dai trigger del database) ----------
const LOG_TAB = { soci: 'Soci', abbonamenti: 'Abbonamenti', pagamenti: 'Pagamenti', piani: 'Piani', accessi: 'Accessi', mail_log: 'Posta', informative_privacy: 'Informative privacy', consensi_eventi: 'Privacy soci' };
const LOG_OP = { INSERT: ['Nuovo', 'g'], UPDATE: ['Modifica', 'w'], DELETE: ['Eliminato', 'b'] };
const LOG_MAX = 500;
const logState = { period: '7', tab: '', query: '' };
let logCache = null;   // { key, rows }
const LOG_COLS = 'id,creato_il,utente,tabella,operazione,record_id,prima,dopo';
const logMsg = (html, color = 'var(--ink-3)') => `<tr><td colspan="5" style="text-align:center;color:${color};padding:28px">${html}</td></tr>`;

async function loadLog() {
  const key = `${logState.period}|${logState.tab}`;
  if (!logCache || logCache.key !== key) {
    $('#logtable tbody').innerHTML = logMsg('Caricamento…');
    try {
      const supa = await getSupa();
      if (!supa) throw new Error('Connessione Supabase non disponibile.');
      const from = logState.period === 'tutti' ? null : logState.period === 'oggi' ? periodStart('oggi') : new Date(Date.now() - Number(logState.period) * 86400000);
      const query = (cols) => {
        let q = supa.from('audit_log').select(cols).order('creato_il', { ascending: false }).limit(LOG_MAX);
        if (from) q = q.gte('creato_il', from.toISOString());
        if (logState.tab) q = q.eq('tabella', logState.tab);
        return q;
      };
      let { data, error } = await query(LOG_COLS + ',azione,sql,origine,transazione');
      // colonne di dettaglio non ancora create (SQL "audit_log_dettagli" non eseguito): usa quelle base
      if (error && /azione|sql|origine|transazione/.test(errMsg(error))) ({ data, error } = await query(LOG_COLS));
      if (error) throw error;
      if (key !== `${logState.period}|${logState.tab}`) return;   // filtro cambiato nel frattempo
      logCache = { key, rows: data || [] };
    } catch (err) {
      console.error(errMsg(err));
      $('#logtable tbody').innerHTML = logMsg(`Errore caricamento log: ${esc(errMsg(err))}`, 'var(--bad)');
      return;
    }
  }
  renderLog();
}

// a chi/cosa si riferisce la riga: nome del socio quando si riesce a risalire, altrimenti nome/descrizione/id breve
function logRef(r) {
  const d = { ...(r.prima || {}), ...(r.dopo || {}) };
  const sid = r.tabella === 'soci' ? r.record_id : d.socio_id;
  const m = sid && DATA.members.find((x) => x.sid === sid);
  if (m) return m.nome;
  if (r.tabella === 'soci' && (d.nome || d.cognome)) return `${d.nome || ''} ${d.cognome || ''}`.trim();
  return d.nome || d.descrizione || d.oggetto || d.versione || (r.record_id ? String(r.record_id).slice(0, 8) : '—');
}
const logVal = (v) => { const s = v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };
function logDetail(r) {
  if (r.operazione === 'UPDATE') return Object.keys(r.dopo || {}).map((k) => `<div><b>${esc(k)}</b>: ${esc(logVal(r.prima?.[k]))} → ${esc(logVal(r.dopo[k]))}</div>`).join('');
  return Object.entries(r.dopo || r.prima || {})
    .filter(([k, v]) => k !== 'id' && k !== 'creato_il' && !k.endsWith('_id') && v !== null && v !== '')
    .slice(0, 5).map(([k, v]) => `<b>${esc(k)}</b>: ${esc(logVal(v))}`).join(' · ');
}

const logTabName = (t) => LOG_TAB[t] || t;
const logFmtDT = (d) => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// tabelle toccate nella stessa transazione (es. annullo abbonamento → eliminati anche i pagamenti)
function logTabelle(r) {
  if (r.transazione == null) return [r.tabella];
  return [...new Set((logCache?.rows || []).filter((x) => x.transazione === r.transazione).map((x) => x.tabella))];
}
const logAzione = (r) => r.azione || `${LOG_OP[r.operazione]?.[0] || r.operazione} · ${logTabName(r.tabella)} · ${r.ref || logRef(r)}`;

function renderLog() {
  const q = normName(logState.query);
  const list = (logCache?.rows || []).map((r) => ({ ...r, ref: logRef(r) }))
    .filter((r) => !q || normName(`${r.utente} ${r.ref} ${r.azione || ''} ${logTabName(r.tabella)} ${r.sql || ''} ${JSON.stringify(r.prima)} ${JSON.stringify(r.dopo)}`).includes(q));
  $('#logtable tbody').innerHTML = list.map((r) => {
    const [op, cls] = LOG_OP[r.operazione] || [r.operazione, 'n'];
    const tabs = logTabelle(r);
    return `<tr data-log="${r.id}" title="Clicca per il dettaglio completo (SQL e dati)"><td class="mono">${logFmtDT(r.creato_il)}</td><td>${esc(r.utente || '—')}</td><td><span class="tag ${cls}">${op}</span><span class="logsub">${esc(logTabName(r.tabella))}</span></td><td>${esc(logAzione(r))}${tabs.length > 1 ? `<span class="logsub">Tabelle coinvolte: ${esc(tabs.map(logTabName).join(', '))}</span>` : ''}</td><td class="logdet">${logDetail(r) || '—'}</td></tr>`;
  }).join('') || logMsg('Nessuna attività nel periodo selezionato');
  const n = logCache?.rows.length || 0;
  $('#logcount').textContent = `${list.length} ${list.length === 1 ? 'operazione' : 'operazioni'}${n >= LOG_MAX ? ` · mostrate le ultime ${LOG_MAX}: restringi periodo o sezione per vedere le precedenti` : ''}`;
  document.querySelectorAll('#logfilters .chip').forEach((c) => c.classList.toggle('active', c.dataset.p === logState.period));
}

function openLogDetail(id) {
  const r = (logCache?.rows || []).find((x) => String(x.id) === String(id)); if (!r) return;
  const json = (v) => (v ? JSON.stringify(v, null, 2) : '—');
  const riga = (label, val) => `<div><span>${label}</span><b>${esc(val || '—')}</b></div>`;
  const tabs = logTabelle(r);
  $('#ld-sub').textContent = `${logFmtDT(r.creato_il)} · ${r.utente || '—'}`;
  $('#ld-body').innerHTML = `
    <div class="scheda-grid" style="margin-bottom:14px">
      ${riga('Cosa è stato fatto', logAzione(r))}
      ${riga('Operazione', `${LOG_OP[r.operazione]?.[0] || r.operazione} (${r.operazione}) su ${r.tabella}`)}
      ${riga('Tabelle coinvolte', tabs.join(', '))}
      ${riga('Origine', r.origine)}
      ${riga('Utente', r.utente)}
      ${riga('Id record', r.record_id)}
    </div>
    <div class="loghead">Istruzione SQL eseguita</div>
    <pre class="logpre">${esc(r.sql || 'Non disponibile (operazione registrata prima dell’aggiornamento del log)')}</pre>
    ${r.origine?.startsWith('App') ? '<div class="msub" style="margin:-8px 0 12px">Dall’app la query è generata dall’API di Supabase: i valori inviati sono qui sotto in “Dati”.</div>' : ''}
    <div class="loghead">Dati prima</div><pre class="logpre">${esc(json(r.prima))}</pre>
    <div class="loghead">Dati dopo</div><pre class="logpre">${esc(json(r.dopo))}</pre>`;
  openModal('modal-logdet');
}

// ---------- navigazione ----------
const titles = {
  dashboard: ['Dashboard', 'Panoramica attività'], anagrafiche: ['Anagrafiche soci', 'Gestione iscritti e tesseramenti'],
  abbonamenti: ['Abbonamenti', 'Listino piani e incasso ricorrente'], entrate: ['Entrate / Accessi', 'Controllo ingressi'],
  posta: ['Posta', 'Comunicazioni automatiche agli iscritti'],
  pagamenti: ['Pagamenti', 'Riepilogo incassi'], log: ['Log attività', 'Tutte le modifiche al database, con utente e dettagli'],
};
function go(view) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
  $('#view-' + view).hidden = false;
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  $('#pg-title').textContent = titles[view][0];
  $('#pg-sub').textContent = titles[view][1];
  $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show');
  window.scrollTo(0, 0);
  if (view === 'pagamenti') loadPayments();
  if (view === 'log') { logCache = null; loadLog(); }   // ogni apertura rilegge il log aggiornato
}

// ---------- login ----------
async function ensureAuth() {
  const supa = await getSupa();
  if (!supa) {
    $('#loginerr').textContent = 'Configurazione Supabase mancante. Verifica il file di configurazione del deploy.';
    $('#login').hidden = false;
    return false;
  }

  const { data: { session }, error } = await supa.auth.getSession();
  if (error) {
    $('#loginerr').textContent = error.message || 'Sessione non disponibile.';
    $('#login').hidden = false;
    return false;
  }

  if (session) return true;
  $('#login').hidden = false;
  return false;
}

function wireEvents() {
  document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => go(n.dataset.view)));
  $('#th-scad').addEventListener('click', () => {
    memState.sort = memState.sort === null ? 'asc' : memState.sort === 'asc' ? 'desc' : null;
    memState.page = 1; renderMembers();
  });
  $('#memsearch').addEventListener('input', (e) => { memState.query = e.target.value; memState.page = 1; renderMembers(); });
  $('#memfilters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    document.querySelectorAll('#memfilters .chip').forEach((c) => c.classList.remove('active'));
    b.classList.add('active'); memState.filter = b.dataset.f; memState.page = 1;
    $('#mem-expfilters').hidden = memState.filter !== 'In scadenza';
    renderMembers();
  });
  $('#mem-expfilters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    document.querySelectorAll('#mem-expfilters .chip').forEach((c) => c.classList.toggle('active', c === b));
    memState.expWindow = +b.dataset.w; memState.page = 1; renderMembers();
  });
  $('#planfilters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    document.querySelectorAll('#planfilters .chip').forEach((c) => c.classList.remove('active'));
    b.classList.add('active');
    planFilter = b.dataset.planState || 'attivo';
    renderPlans();
  });
  $('#mempager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    const p = b.dataset.p; if (p === 'prev') memState.page--; else if (p === 'next') memState.page++; else memState.page = +p;
    renderMembers();
  });
  $('#burger').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
  try { const s = localStorage.getItem('gymin-collapsed'); document.querySelector('.app').classList.toggle('collapsed', s === null ? true : s === '1'); } catch { document.querySelector('.app').classList.add('collapsed'); }
  $('#collapse').addEventListener('click', () => {
    const on = document.querySelector('.app').classList.toggle('collapsed');
    try { localStorage.setItem('gymin-collapsed', on ? '1' : '0'); } catch {}
    hideTip();
  });
  $('#scrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); });
  $('#theme').addEventListener('click', () => {
    const r = document.documentElement;
    const cur = r.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    r.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  });

  $('#btn-nuovo').addEventListener('click', () => openSocioModal('new'));
  $('#socioform').addEventListener('submit', submitSocio);
  // controllo duplicati mentre si digita nome / cognome / email / telefono
  let dupTimer;
  ['#f-nome', '#f-cognome', '#f-email', '#f-tel'].forEach((id) => $(id).addEventListener('input', () => {
    $(id).classList.remove('invalid');
    clearTimeout(dupTimer);
    dupTimer = setTimeout(renderDuplicates, 250);
  }));
  $('#modal-dup').addEventListener('click', async (e) => {
    if (e.target.closest('[data-dup-back]')) return closeDupModal();
    const open = e.target.closest('[data-dup-open]');
    if (open) { closeDupModal(); closeModal('modal-socio'); return openScheda(open.dataset.dupOpen); }
    const use = e.target.closest('[data-dup-use]');
    const force = e.target.closest('[data-dup-force]');
    if (!use && !force) return;
    const f = pendingSocio;
    e.target.closest('.modal').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    if (use) return useExistingSocio(use.dataset.dupUse);
    closeDupModal();
    await saveSocio(f);
  });
  $('#btn-accesso').addEventListener('click', openAccessoModal);
  $('#privacyform').addEventListener('submit', submitPrivacySocio);
  $('#accessoform').addEventListener('submit', submitAccesso);
  $('#btn-reminders').addEventListener('click', sendReminders);
  $('#exp-filters').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; expWindow = +b.dataset.w; renderDashboard(); });
  $('#btn-send-real-mail').addEventListener('click', sendRealMail);
  $('#btn-clear-posta').addEventListener('click', clearPosta);
  $('#btn-settings').addEventListener('click', openSettingsModal);
  $('#settingsform').addEventListener('submit', saveSettingsFromModal);
  $('#settings-reset').addEventListener('click', resetSettingsToDefault);
  $('#btn-gestisci-piani').addEventListener('click', openPlanManager);
  $('#planform').addEventListener('submit', submitPlanForm);
  $('#plan-reset').addEventListener('click', resetPlanForm);
  $('#r-piano').addEventListener('change', updateRinnovoPreview);
  $('#rinnovoform').addEventListener('submit', doRenew);
  $('#quickform').addEventListener('submit', doQuickRenew);
  $('#payfilters').addEventListener('click', (e) => {
    const c = e.target.closest('[data-p]'); if (!c) return;
    payState.period = c.dataset.p;
    loadPayments();
  });
  $('#payfor').addEventListener('click', () => { payState.sid = null; loadPayments(); });
  $('#btn-pagamento').addEventListener('click', openPagamentoModal);
  $('#payeditform').addEventListener('submit', submitPayEdit);
  $('#paydelform').addEventListener('submit', submitPayDel);
  $('#logtab').innerHTML += Object.entries(LOG_TAB).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#logfilters').addEventListener('click', (e) => { const c = e.target.closest('[data-p]'); if (!c) return; logState.period = c.dataset.p; loadLog(); });
  $('#logtable tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-log]'); if (tr) openLogDetail(tr.dataset.log); });
  $('#logtab').addEventListener('change', (e) => { logState.tab = e.target.value; loadLog(); });
  let logTimer;
  $('#logsearch').addEventListener('input', (e) => { clearTimeout(logTimer); logTimer = setTimeout(() => { logState.query = e.target.value; renderLog(); }, 150); });
  $('#pagamentoform').addEventListener('submit', submitPagamento);
  accPicker = socioPicker('a-socio');
  payPicker = socioPicker('p-socio', onPagamentoSocio);
  $('#p-piano').addEventListener('change', onPagamentoPiano);
  $('#p-tipo').addEventListener('change', onPagamentoPiano);
  $('#p-usato').addEventListener('change', updatePagamentoForm);
  let payTimer;
  $('#paysearch').addEventListener('input', (e) => {
    clearTimeout(payTimer);
    payTimer = setTimeout(() => { payState.query = e.target.value; renderPayments(); }, 150);
  });
  $('#posta tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) openMailPreview(+tr.dataset.i); });
  // delega globale: chiusura modali, rinnovo rapido, rinnovo con opzioni, apri scheda
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]'); if (c) return closeModal(c.dataset.close);
    const planEdit = e.target.closest('[data-plan-edit]'); if (planEdit) return editPlan(planEdit.dataset.planEdit);
    const planDel = e.target.closest('[data-plan-delete]'); if (planDel) return deletePlan(planDel.dataset.planDelete);
    const ed = e.target.closest('[data-edit]'); if (ed) return openSocioModal('edit', ed.dataset.edit);
    const rd = e.target.closest('[data-remind]'); if (rd) return sendReminderTo(rd.dataset.remind);
    const q = e.target.closest('[data-quickrenew]'); if (q) return quickRenew(q.dataset.quickrenew);
    const r = e.target.closest('[data-renew]'); if (r) return openRinnovoModal(r.dataset.renew);
    const pay = e.target.closest('[data-payments]'); if (pay) return openPayments(pay.dataset.payments);
    const pe = e.target.closest('[data-payedit]'); if (pe) return openPayEdit(pe.dataset.payedit);
    const pd = e.target.closest('[data-paydel]'); if (pd) return openPayDel(pd.dataset.paydel);
    if (e.target.closest('[data-informativa]')) return openInformativa();
    const ps = e.target.closest('[data-privacy-socio]'); if (ps) return openPrivacySocio(ps.dataset.privacySocio);
    const rv = e.target.closest('[data-revoca]'); if (rv) return revocaMarketing(rv.dataset.revoca);
    const mm = e.target.closest('[data-member]'); if (mm) return openScheda(mm.dataset.member);
  });
  document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) closeModal(o.id); }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.overlay:not([hidden])').forEach((o) => closeModal(o.id));
    if (e.key === 'Enter') { const mm = e.target.closest && e.target.closest('[data-member]'); if (mm) { e.preventDefault(); openScheda(mm.dataset.member); } }
  });

  $('#loginform')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const supa = await getSupa();
    const err = $('#loginerr'); err.textContent = '';
    if (!supa) {
      err.textContent = 'Configurazione Supabase mancante. Verifica il file config.js e le variabili del deploy.';
      return;
    }
    const { error } = await supa.auth.signInWithPassword({ email: $('#email').value, password: $('#pwd').value });
    if (error) { err.textContent = 'Accesso non riuscito: ' + error.message; return; }
    $('#login').hidden = true; boot();
  });
}

async function savePlanToSupabase(plan) {
  const supa = await getSupa();
  if (!supa) {
    throw new Error('Connessione Supabase non disponibile. Verifica la configurazione del database.');
  }

  if (!(await canManagePlans())) {
    throw new Error('Solo gli admin possono modificare i piani');
  }

  const payload = {
    nome: plan.name,
    prezzo: Number(plan.price || 0),
    durata_mesi: Number(plan.dur || 1),
    entrate: Number(plan.entrate || 0),
    descrizione: plan.descrizione || null,
    attivo: plan.attivo !== false,
  };

  if (plan.id) {
    const { error } = await supa.from('piani').update(payload).eq('id', plan.id);
    if (error) throw error;
  } else {
    const { data, error } = await supa.from('piani').insert(payload).select('id').single();
    if (error) throw error;
    plan.id = data.id;
  }
  DATA = await loadData();
  renderAll();
  return true;
}

async function deletePlanFromSupabase(id) {
  const supa = await getSupa();
  if (!supa) {
    throw new Error('Connessione Supabase non disponibile. Verifica la configurazione del database.');
  }
  if (!(await canManagePlans())) {
    throw new Error('Solo gli admin possono eliminare i piani');
  }
  const { error } = await supa.from('piani').delete().eq('id', id);
  if (error) throw error;
  DATA = await loadData();
  renderAll();
  return true;
}

function resetPlanForm() {
  $('#plan-name').value = '';
  $('#plan-price').value = '0';
  $('#plan-durata').value = '1';
  $('#plan-entrate').value = '0';
  $('#plan-descrizione').value = '';
  $('#plan-attivo').checked = true;
  $('#plan-save').textContent = 'Salva piano';
  $('#planform').dataset.planId = '';
}

async function openPlanManager() {
  if (!(await canManagePlans())) {
    toast('Solo gli admin possono gestire i piani', 'warn');
    return;
  }
  resetPlanForm();
  openModal('modal-plan-manager');
}

async function submitPlanForm(e) {
  e.preventDefault();
  const name = $('#plan-name').value.trim();
  const price = Number($('#plan-price').value || 0);
  const dur = Number($('#plan-durata').value || 1);
  const entrate = Number($('#plan-entrate').value || 0);
  const descrizione = $('#plan-descrizione').value.trim();
  const attivo = $('#plan-attivo').checked;
  if (!name) { toast('Inserisci un nome per il piano', 'warn'); return; }

  const plan = {
    id: $('#planform').dataset.planId || null,
    name,
    price,
    dur,
    entrate,
    descrizione,
    attivo,
    color: PLAN_COLORS[name] || 'var(--slate)',
    mcost: price / (dur || 1),
  };

  try {
    await savePlanToSupabase(plan);
    toast(plan.id ? `Piano aggiornato · ${name}` : `Piano creato · ${name}`);
    closeModal('modal-plan-manager');
  } catch (err) {
    console.error(errMsg(err));
    toast('Errore salvataggio piano: ' + errMsg(err), 'warn');
  }
}

async function editPlan(id) {
  if (!(await canManagePlans())) {
    toast('Solo gli admin possono modificare i piani', 'warn');
    return;
  }
  const plan = DATA.plans.find((p) => (p.id || p.name) === id) || DATA.plans.find((p) => p.name === id);
  if (!plan) return;
  $('#planform').dataset.planId = plan.id || plan.name;
  $('#plan-name').value = plan.name;
  $('#plan-price').value = String(plan.price || 0);
  $('#plan-durata').value = String(plan.dur || 1);
  $('#plan-entrate').value = String(plan.entrate || 0);
  $('#plan-descrizione').value = plan.descrizione || '';
  $('#plan-attivo').checked = plan.attivo !== false;
  $('#plan-save').textContent = 'Aggiorna piano';
  openModal('modal-plan-manager');
}

async function deletePlan(id) {
  if (!(await canManagePlans())) {
    toast('Solo gli admin possono eliminare i piani', 'warn');
    return;
  }
  const plan = DATA.plans.find((p) => (p.id || p.name) === id) || DATA.plans.find((p) => p.name === id);
  if (!plan) return;
  const ok = await askConfirm(`Eliminare il piano <b>${plan.name}</b>?`, 'Elimina', ic.alert);
  if (!ok) return;
  try {
    await deletePlanFromSupabase(plan.id || plan.name);
    toast(`Piano eliminato · ${plan.name}`);
    closeModal('modal-plan-manager');
  } catch (err) {
    console.error(errMsg(err));
    toast('Errore eliminazione piano: ' + errMsg(err), 'warn');
  }
}

async function boot() {
  const ok = await ensureAuth();
  if (!ok) return;

  try {
    DATA = await loadData();
    renderAll();
  } catch (err) {
    console.error(errMsg(err));
    $('#loginerr').textContent = errMsg(err) || 'Impossibile connettersi al database Supabase.';
    $('#login').hidden = false;
  }
}

wireEvents();
boot();
