import { loadData, getSupa, PLAN_COLORS } from './data.js';
import { templates } from './mailtemplates.js';

const $ = (s, r = document) => r.querySelector(s);
const euro = (n) => '€ ' + Math.round(n).toLocaleString('it-IT');
const fmtDate = (d) => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
const initials = (n) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const AV = ['#f4511e', '#2563eb', '#0d9488', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#4f46e5'];

let DATA = null;
const MAILBOX = [];
const reminded = new Set();
const memState = { filter: 'all', query: '', page: 1, PER: 9 };
let planFilter = 'attivo';
let socioMode = 'new';
let editSid = null;
let expWindow = 7;   // finestra "in scadenza" della dashboard: 7 / 15 / 30 giorni
// soci con abbonamento a tempo in scadenza entro expWindow giorni (esclude i carnet, che sono a consumo)
const expiringList = () => DATA.members.filter((m) => !m.plan.entrate && m.dleft >= 0 && m.dleft <= expWindow).sort((a, b) => a.dleft - b.dleft);

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
const statoDa = (dleft) => (dleft < 0 ? 'Scaduto' : dleft <= 30 ? 'In scadenza' : 'Attivo');
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
const editSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
// stessi pulsanti-icona usati sia in tabella sia nella scheda socio
const actionIcons = (m) => `<button class="ibtn edit" data-edit="${m.sid}" data-tip="Modifica dati" aria-label="Modifica dati">${editSvg}</button><button class="ibtn remind" data-remind="${m.sid}" data-tip="Invia promemoria" aria-label="Invia promemoria">${mailSvg}</button><button class="ibtn quick" data-quickrenew="${m.sid}" data-tip="Rinnovo rapido · mantiene il piano" aria-label="Rinnovo rapido">${zapSvg}</button><button class="ibtn full" data-renew="${m.sid}" data-tip="Rinnova · scegli il piano" aria-label="Rinnova con opzioni">${refreshSvg}</button>`;
const actionsCell = (m) => `<td><div class="actions-cell">${actionIcons(m)}</div></td>`;

function renderDashboard() {
  const { members, revenue, plans } = DATA;
  const attivi = members.filter((m) => m.stato === 'Attivo');
  const scad = members.filter((m) => m.stato === 'In scadenza');
  const scaduti = members.filter((m) => m.stato === 'Scaduto');
  const rev = revenue.map((r) => r.value);
  const cur = rev.at(-1), prev = rev.at(-2) || cur;
  const growth = prev ? ((cur - prev) / prev * 100) : 0;

  $('#kpis').innerHTML =
    kpi('Fatturato (mese)', ic.euro, 'var(--accent-soft)', 'var(--accent-ink)', euro(cur), `${growth >= 0 ? '↑' : '↓'} ${Math.abs(growth).toFixed(1)}% vs mese prec.`, growth >= 0 ? 'trend-up' : 'trend-dn', sparkline(rev.slice(6), 'var(--accent)')) +
    kpi('Contratti attivi', ic.users, 'var(--good-bg)', 'var(--good)', attivi.length, `${(attivi.length / members.length * 100).toFixed(0)}% dei soci`, 'trend-up', '') +
    kpi('In scadenza (30gg)', ic.alert, 'var(--warn-bg)', 'var(--warn)', scad.length, 'Da contattare per rinnovo', '', '') +
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
  $('#exp-title').textContent = `In scadenza nei prossimi ${expWindow} giorni`;
  $('#exp-sub').textContent = `${expAll.length} ${expAll.length === 1 ? 'socio' : 'soci'} · da contattare per il rinnovo`;
  document.querySelectorAll('#exp-filters .chip').forEach((c) => c.classList.toggle('active', +c.dataset.w === expWindow));
  $('#expiring tbody').innerHTML = exp.map((m) => `<tr><td>${who(m)}</td><td><span class="plan-pill">${m.plan.name}</span></td><td class="mono">${fmtDate(m.end)} <span style="color:var(--warn);font-weight:600">· ${m.dleft}gg</span></td><td class="mono">${euro(m.plan.price)}</td>${actionsCell(m)}</tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:20px">Nessun socio in scadenza nei prossimi ${expWindow} giorni</td></tr>`;
}

function renderMembers() {
  const list = DATA.members.filter((m) => {
    const mf = memState.filter === 'all' || m.stato === memState.filter;
    const q = (memState.query || '').toLowerCase();
    const nome = (m.nome || '').toLowerCase();
    const email = (m.email || '').toLowerCase();
    const id = String(m.id || '').toLowerCase();
    const mailQuery = !q || nome.includes(q) || email.includes(q) || id.includes(q);
    return mf && mailQuery;
  });
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
  $('#posta tbody').innerHTML = MAILBOX.map((m, i) => `<tr data-i="${i}" style="cursor:pointer"><td class="mono">${m.when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td><td><span class="plan-pill">${m.tipoLabel}</span></td><td><b>${m.nome}</b><br><span style="color:var(--ink-3);font-size:12px">${m.destinatario}</span></td><td>${m.subject}</td><td>${m.channel === 'mailpit' ? '<span class="tag g">Mailpit</span>' : '<span class="tag w">Anteprima</span>'}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:28px">Nessuna mail inviata. Aggiungi un socio o invia i promemoria di rinnovo.</td></tr>';
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
async function sendMail({ tipo, tipoLabel, member, subject, html }) {
  const mail = { tipo, tipoLabel, nome: member.nome, destinatario: member.email, subject, html, when: new Date(), channel: 'preview' };
  if (await toMailpit(mail)) mail.channel = 'mailpit';
  MAILBOX.unshift(mail);
  renderPosta();
  return mail;
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
  $('#mail-subject').textContent = m.subject;
  $('#mail-to').textContent = m.destinatario;
  $('#mailframe').srcdoc = m.html;
  openModal('modal-mail');
}
async function sendReminderTo(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  if (!m.email) { toast('Il socio non ha un indirizzo email', 'warn'); return; }
  const { subject, html } = templates.rinnovo(m, Math.max(0, m.dleft));
  const mail = await sendMail({ tipo: 'rinnovo', tipoLabel: 'Rinnovo', member: m, subject, html });
  reminded.add(m.sid);
  toast(mail.channel === 'mailpit' ? `Promemoria inviato a Mailpit · ${m.email}` : `Promemoria generato (anteprima) · ${m.nome}`, 'mail');
}
async function sendReminders() {
  const list = expiringList().filter((m) => m.email && !reminded.has(m.sid));
  if (!list.length) { toast('Nessun nuovo promemoria da inviare', 'warn'); return; }
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
    ok: !!(nome && cognome), firstName: nome, lastName: cognome, nome: `${nome} ${cognome}`,
    email: $('#f-email').value.trim(), telefono: $('#f-tel').value.trim(),
    sesso: $('#f-sesso').value, dataNascita: $('#f-nascita').value, cf: $('#f-cf').value.trim().toUpperCase(),
    indirizzo: $('#f-indirizzo').value.trim(), citta: $('#f-citta').value.trim(), cap: $('#f-cap').value.trim(),
    note: $('#f-note').value.trim(), consenso: $('#f-consenso').checked,
  };
}

async function normalizeMemberEmail(supa, email, currentId = null) {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return null;

  let query = supa.from('soci').select('id,email').eq('email', clean);
  if (currentId) query = query.neq('id', currentId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return data && data.length ? null : clean;
}

async function findExistingSocioByEmail(supa, email) {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return null;
  const { data, error } = await supa.from('soci').select('id,nome,cognome,email,tessera').eq('email', clean).limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function saveMemberToSupabase({ form, plan, start, end, tessera }) {
  const supa = await getSupa();
  if (!supa) {
    throw new Error('Connessione Supabase non disponibile. Verifica la configurazione del database.');
  }

  const cleanEmail = (form.email || '').trim().toLowerCase();
  const existing = cleanEmail ? await findExistingSocioByEmail(supa, cleanEmail) : null;
  if (existing) {
    const existingName = [existing.nome, existing.cognome].filter(Boolean).join(' ') || existing.email || 'socio esistente';
    toast(`Email già registrata per ${existingName}. Verrà usato il socio esistente.`, 'warn');
    const useExisting = window.confirm(`Esiste già un socio con questa email (${cleanEmail}). Vuoi usare il profilo già presente: ${existingName}?`);
    if (!useExisting) {
      throw new Error(`Email già registrata per ${existingName}.`);
    }

    const updatePayload = {
      nome: form.firstName || existing.nome,
      cognome: form.lastName || existing.cognome,
      email: cleanEmail,
      telefono: form.telefono || existing.telefono || null,
      data_nascita: form.dataNascita || null,
      sesso: form.sesso || existing.sesso || null,
      codice_fiscale: form.cf || existing.codice_fiscale || null,
      indirizzo: form.indirizzo || existing.indirizzo || null,
      citta: form.citta || existing.citta || null,
      cap: form.cap || existing.cap || null,
      note: form.note || existing.note || null,
      consenso_mail: !!form.consenso,
      tessera: tessera || existing.tessera || null,
    };
    const { error: updErr } = await supa.from('soci').update(updatePayload).eq('id', existing.id);
    if (updErr) throw updErr;

    const planLookup = plan.id ? { key: 'id', value: plan.id } : { key: 'nome', value: plan.name };
    const { data: planRow, error: planErr } = await supa.from('piani').select('id').eq(planLookup.key, planLookup.value).maybeSingle();
    if (planErr) throw planErr;
    if (!planRow) throw new Error(`Piano non trovato in database: ${plan.name}`);

    const abbRow = {
      socio_id: existing.id,
      piano_id: planRow.id,
      data_inizio: start.toISOString().slice(0, 10),
      data_scadenza: end.toISOString().slice(0, 10),
      entrate_residue: plan.entrate ? Number(plan.entrate) : null,
      stato: 'attivo',
    };
    const { data: ab, error: abbErr } = await supa.from('abbonamenti').insert(abbRow).select('id').single();
    if (abbErr) throw abbErr;

    const { error: payErr } = await supa.from('pagamenti').insert({
      abbonamento_id: ab.id,
      importo: Number(plan.price || 0),
      metodo: 'contanti',
      data: new Date().toISOString(),
    });
    if (payErr) throw payErr;

    return { id: existing.id, tessera: existing.tessera || tessera || null, existingUser: existing };
  }

  const payload = {
    nome: form.firstName,
    cognome: form.lastName,
    email: cleanEmail || null,
    telefono: form.telefono || null,
    data_nascita: form.dataNascita || null,
    sesso: form.sesso || null,
    codice_fiscale: form.cf || null,
    indirizzo: form.indirizzo || null,
    citta: form.citta || null,
    cap: form.cap || null,
    note: form.note || null,
    consenso_mail: !!form.consenso,
    tessera: tessera || null,
  };

  const { data: sof, error: socErr } = await supa.from('soci').insert(payload).select('id,tessera').single();
  if (socErr) throw socErr;

  const planLookup = plan.id ? { key: 'id', value: plan.id } : { key: 'nome', value: plan.name };
  const { data: planRow, error: planErr } = await supa.from('piani').select('id').eq(planLookup.key, planLookup.value).maybeSingle();
  if (planErr) throw planErr;
  if (!planRow) throw new Error(`Piano non trovato in database: ${plan.name}`);

  const abbRow = {
    socio_id: sof.id,
    piano_id: planRow.id,
    data_inizio: start.toISOString().slice(0, 10),
    data_scadenza: end.toISOString().slice(0, 10),
    entrate_residue: plan.entrate ? Number(plan.entrate) : null,
    stato: 'attivo',
  };

  const { data: ab, error: abbErr } = await supa.from('abbonamenti').insert(abbRow).select('id').single();
  if (abbErr) throw abbErr;

  const { error: payErr } = await supa.from('pagamenti').insert({
    abbonamento_id: ab.id,
    importo: Number(plan.price || 0),
    metodo: 'contanti',
    data: new Date().toISOString(),
  });
  if (payErr) throw payErr;

  return sof;
}

async function submitSocio(e) {
  e.preventDefault();
  const f = readSocioForm();
  if (!f.ok) return;
  delete f.ok;

  if (socioMode === 'edit') {
    const m = DATA.members.find((x) => x.sid === editSid); if (!m) return;
    try {
      const supa = await getSupa();
      if (supa) {
        const safeEmail = await normalizeMemberEmail(supa, f.email, m.sid);
        const { error } = await supa.from('soci').update({
          nome: f.firstName,
          cognome: f.lastName,
          email: safeEmail,
          telefono: f.telefono || null,
          data_nascita: f.dataNascita || null,
          sesso: f.sesso || null,
          codice_fiscale: f.cf || null,
          indirizzo: f.indirizzo || null,
          citta: f.citta || null,
          cap: f.cap || null,
          note: f.note || null,
          consenso_mail: !!f.consenso,
        }).eq('id', m.sid);
        if (error) throw error;
      }
    } catch (err) {
      console.error(err);
      toast('Errore aggiornamento socio: ' + (err.message || err), 'warn');
      return;
    }
    Object.assign(m, f);
    renderAll();
    closeModal('modal-socio');
    toast(`Dati aggiornati · ${m.nome}`);
    openScheda(m.sid);
    return;
  }

  const plan = DATA.plans.find((p) => p.name === $('#f-piano').value);
  const start = new Date($('#f-inizio').value || Date.now());
  const end = addMonths(start, plan.dur);
  const dleft = giorniTo(end);
  const member = {
    sid: 'new-' + Date.now(), id: nextTessera(), ...f,
    email: f.email || `${f.firstName}.${f.lastName}`.toLowerCase().replace(/ /g, '') + '@email.it',
    plan: { name: plan.name, price: plan.price, mcost: plan.mcost, dur: plan.dur, color: plan.color, entrate: plan.entrate },
    entrateResidue: plan.entrate ? plan.entrate : undefined,
    start, end, dleft, av: AV[DATA.members.length % AV.length],
  };
  member.stato = computeStato(member);

  try {
    const supa = await getSupa();
    if (supa) {
      const socRow = await saveMemberToSupabase({ form: f, plan, start, end, tessera: member.id });
      member.sid = socRow.id;
      member.id = socRow.tessera || member.id;
      DATA = await loadData();
      renderAll();
      closeModal('modal-socio');
      if (socRow.existingUser) {
        const existingName = [socRow.existingUser.nome, socRow.existingUser.cognome].filter(Boolean).join(' ') || socRow.existingUser.email || 'socio esistente';
        toast(`Email già presente: usato ${existingName} e creato un nuovo abbonamento`, 'warn');
      } else {
        toast(`Socio ${member.nome} aggiunto · ${plan.name}`);
      }
      if (member.consenso) {
        const { subject, html } = templates.benvenuto(member);
        const mail = await sendMail({ tipo: 'benvenuto', tipoLabel: 'Benvenuto', member, subject, html });
        toast(mail.channel === 'mailpit'
          ? `Mail di benvenuto inviata a Mailpit · ${member.email}`
          : `Mail di benvenuto generata (anteprima) · apri la sezione Posta`, 'mail');
      }
      memState.filter = 'all'; memState.query = ''; memState.page = 1;
      $('#memsearch').value = '';
      document.querySelectorAll('#memfilters .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === 'all'));
      go('anagrafiche');
      return;
    }
  } catch (err) {
    console.error(err);
    toast('Errore inserimento socio: ' + (err.message || err), 'warn');
    return;
  }

  DATA.members.unshift(member);
  recomputePlans();
  DATA.revenue.at(-1).value += plan.price;       // incassa la quota nel mese corrente
  renderAll();
  closeModal('modal-socio');
  toast(`Socio ${member.nome} aggiunto · ${plan.name}`);
  if (member.consenso) {
    const { subject, html } = templates.benvenuto(member);
    const mail = await sendMail({ tipo: 'benvenuto', tipoLabel: 'Benvenuto', member, subject, html });
    toast(mail.channel === 'mailpit'
      ? `Mail di benvenuto inviata a Mailpit · ${member.email}`
      : `Mail di benvenuto generata (anteprima) · apri la sezione Posta`, 'mail');
  }
  memState.filter = 'all'; memState.query = ''; memState.page = 1;
  $('#memsearch').value = '';
  document.querySelectorAll('#memfilters .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === 'all'));
  go('anagrafiche');
}

function openAccessoModal() {
  const opts = [...DATA.members].sort((a, b) => a.nome.localeCompare(b.nome))
    .map((m) => `<option value="${m.sid}">${m.nome} — ${m.id} (${m.stato})</option>`).join('');
  $('#a-socio').innerHTML = opts;
  openModal('modal-accesso');
}
function submitAccesso(e) {
  e.preventDefault();
  const m = DATA.members.find((x) => x.sid === $('#a-socio').value);
  if (!m) return;
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
function renewBase(m) { const t = new Date(); t.setHours(0, 0, 0, 0); return new Date(m.end) >= t ? new Date(m.end) : t; }
function openRinnovoModal(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  renewSid = sid;
  closeModal('modal-scheda');
  $('#r-socio').textContent = `${m.nome} · ${m.id}`;
  $('#r-piano').innerHTML = DATA.plans.map((p) => `<option value="${p.name}"${p.name === m.plan.name ? ' selected' : ''}>${p.name} — ${euro(p.price)} · ${p.dur} mese/i</option>`).join('');
  $('#r-old').textContent = fmtDate(m.end);
  updateRinnovoPreview();
  openModal('modal-rinnovo');
}
function updateRinnovoPreview() {
  const m = DATA.members.find((x) => x.sid === renewSid); if (!m) return;
  const plan = DATA.plans.find((p) => p.name === $('#r-piano').value);
  $('#r-new').textContent = fmtDate(addMonths(renewBase(m), plan.dur));
}
async function applyRenewal(m, plan, sendRicevuta) {
  const newEnd = addMonths(renewBase(m), plan.dur);
  m.plan = { name: plan.name, price: plan.price, mcost: plan.mcost, dur: plan.dur, color: plan.color, entrate: plan.entrate };
  m.end = newEnd; m.dleft = giorniTo(newEnd);
  m.entrateResidue = plan.entrate ? plan.entrate : undefined;  // il carnet riparte pieno
  m.stato = computeStato(m);
  reminded.delete(m.sid);                       // riabilita eventuali futuri promemoria
  DATA.revenue.at(-1).value += plan.price;      // incassa la quota nel mese corrente
  recomputePlans();
  renderAll();
  toast(`Abbonamento rinnovato · ${m.nome} → scad. ${fmtDate(newEnd)}`);
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
  closeModal('modal-rinnovo');
  await applyRenewal(m, plan, ricevuta);
}
async function quickRenew(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  const plan = DATA.plans.find((p) => p.name === m.plan.name) || m.plan;
  await applyRenewal(m, plan, true);            // rinnovo rapido: stesso piano, con ricevuta
  if (!$('#modal-scheda').hidden) openScheda(sid); // aggiorna la scheda se aperta
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
    </div>
    <div class="mfoot" style="justify-content:space-between;align-items:center">
      <button type="button" class="btn-ghost" data-close="modal-scheda">Chiudi</button>
      <div class="actions-cell">${actionIcons(m)}</div>
    </div>`;
  openModal('modal-scheda');
}

// ---------- navigazione ----------
const titles = {
  dashboard: ['Dashboard', 'Panoramica attività'], anagrafiche: ['Anagrafiche soci', 'Gestione iscritti e tesseramenti'],
  abbonamenti: ['Abbonamenti', 'Listino piani e incasso ricorrente'], entrate: ['Entrate / Accessi', 'Controllo ingressi'],
  posta: ['Posta', 'Comunicazioni automatiche agli iscritti'],
};
function go(view) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
  $('#view-' + view).hidden = false;
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  $('#pg-title').textContent = titles[view][0];
  $('#pg-sub').textContent = titles[view][1];
  $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show');
  window.scrollTo(0, 0);
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
  $('#memsearch').addEventListener('input', (e) => { memState.query = e.target.value; memState.page = 1; renderMembers(); });
  $('#memfilters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    document.querySelectorAll('#memfilters .chip').forEach((c) => c.classList.remove('active'));
    b.classList.add('active'); memState.filter = b.dataset.f; memState.page = 1; renderMembers();
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
  $('#btn-accesso').addEventListener('click', openAccessoModal);
  $('#accessoform').addEventListener('submit', submitAccesso);
  $('#btn-reminders').addEventListener('click', sendReminders);
  $('#exp-filters').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; expWindow = +b.dataset.w; renderDashboard(); });
  $('#btn-clear-posta').addEventListener('click', clearPosta);
  $('#btn-gestisci-piani').addEventListener('click', openPlanManager);
  $('#planform').addEventListener('submit', submitPlanForm);
  $('#plan-reset').addEventListener('click', resetPlanForm);
  $('#r-piano').addEventListener('change', updateRinnovoPreview);
  $('#rinnovoform').addEventListener('submit', doRenew);
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
    console.error(err);
    toast('Errore salvataggio piano: ' + (err.message || err), 'warn');
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
  const ok = window.confirm(`Eliminare il piano "${plan.name}"?`);
  if (!ok) return;
  try {
    await deletePlanFromSupabase(plan.id || plan.name);
    toast(`Piano eliminato · ${plan.name}`);
    closeModal('modal-plan-manager');
  } catch (err) {
    console.error(err);
    toast('Errore eliminazione piano: ' + (err.message || err), 'warn');
  }
}

async function boot() {
  const ok = await ensureAuth();
  if (!ok) return;

  try {
    DATA = await loadData();
    renderAll();
  } catch (err) {
    console.error(err);
    $('#loginerr').textContent = err.message || 'Impossibile connettersi al database Supabase.';
    $('#login').hidden = false;
  }
}

wireEvents();
boot();
