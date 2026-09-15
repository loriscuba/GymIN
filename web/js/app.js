import { loadData, getSupa } from './data.js';
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

const ic = {
  euro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7a7 7 0 1 0 0 10M5 10h8M5 14h8"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
};

// ---------- helpers stato demo ----------
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const giorniTo = (d) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(d) - t) / 86400000); };
const statoDa = (dleft) => (dleft < 0 ? 'Scaduto' : dleft <= 30 ? 'In scadenza' : 'Attivo');
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
const tagFor = (s) => s === 'Attivo' ? '<span class="tag g">Attivo</span>' : s === 'In scadenza' ? '<span class="tag w">In scadenza</span>' : '<span class="tag b">Scaduto</span>';
const who = (m) => `<div class="who"><div class="av" style="background:${m.av}">${initials(m.nome)}</div><div><b>${m.nome}</b><span>${m.id}</span></div></div>`;

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

  const exp = [...scad].sort((a, b) => a.dleft - b.dleft).slice(0, 10);
  $('#expiring tbody').innerHTML = exp.map((m) => `<tr><td>${who(m)}</td><td><span class="plan-pill">${m.plan.name}</span></td><td class="mono">${fmtDate(m.end)} <span style="color:var(--warn);font-weight:600">· ${m.dleft}gg</span></td><td class="mono">${euro(m.plan.price)}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-3);padding:20px">Nessuno in scadenza</td></tr>';
}

function renderMembers() {
  const list = DATA.members.filter((m) => {
    const mf = memState.filter === 'all' || m.stato === memState.filter;
    const q = memState.query.toLowerCase();
    const mq = !q || m.nome.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    return mf && mq;
  });
  const pages = Math.max(1, Math.ceil(list.length / memState.PER));
  if (memState.page > pages) memState.page = pages;
  const slice = list.slice((memState.page - 1) * memState.PER, memState.page * memState.PER);
  $('#memtable tbody').innerHTML = slice.map((m) => `<tr><td>${who(m)}</td><td class="mono">${m.id}</td><td><span class="plan-pill">${m.plan.name}</span></td><td class="mono">${fmtDate(m.start)}</td><td class="mono">${fmtDate(m.end)}</td><td>${tagFor(m.stato)}</td><td><button class="btn-row" data-renew="${m.sid}">Rinnova</button></td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:28px">Nessun socio trovato</td></tr>';
  $('#memcount').textContent = `${list.length} soci · pagina ${memState.page} di ${pages}`;
  let pg = `<button ${memState.page === 1 ? 'disabled' : ''} data-p="prev">‹</button>`;
  for (let i = 1; i <= pages && i <= 6; i++) pg += `<button class="${i === memState.page ? 'active' : ''}" data-p="${i}">${i}</button>`;
  pg += `<button ${memState.page === pages ? 'disabled' : ''} data-p="next">›</button>`;
  $('#mempager').innerHTML = pg;
}

function renderPlans() {
  const { plans } = DATA;
  $('#plans').innerHTML = plans.map((p) => `<div class="plancard${p.name === 'Annuale' ? ' feat' : ''}">${p.name === 'Annuale' ? '<div class="ribbon">Più venduto</div>' : ''}
    <h3>${p.name}</h3><div class="price num">${euro(p.price)}</div>
    <div class="sub-metric"><span>Soci attivi</span><b class="num">${p.active} / ${p.count}</b></div></div>`).join('');
  const mrr = plans.map((p) => ({ p, v: p.active * p.mcost }));
  const tot = mrr.reduce((a, b) => a + b.v, 0), mx = Math.max(...mrr.map((m) => m.v), 1);
  $('#mrr-tot').textContent = 'MRR totale: ' + euro(tot);
  $('#mrrchart').innerHTML = mrr.map((m) => `<div class="distrow"><span class="dl">${m.p.name}</span><div class="track"><div class="fill" style="width:${(m.v / mx * 100).toFixed(0)}%;background:${m.p.color}"></div></div><span class="dv">${euro(m.v)}</span></div>`).join('');
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
  $('#posta tbody').innerHTML = MAILBOX.map((m, i) => `<tr data-i="${i}" style="cursor:pointer"><td class="mono">${m.when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td><td><span class="plan-pill">${m.tipoLabel}</span></td><td><b>${m.nome}</b><br><span style="color:var(--ink-3);font-size:12px">${m.destinatario}</span></td><td>${m.subject}</td><td>${m.channel === 'mailpit' ? '<span class="tag g">Mailpit</span>' : '<span class="tag w">Anteprima demo</span>'}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-3);padding:28px">Nessuna mail inviata. Aggiungi un socio o invia i promemoria di rinnovo.</td></tr>';
}

function renderAll() {
  $('#c-mem').textContent = DATA.members.length;
  $('#c-acc').textContent = DATA.accessi.length;
  $('#modebadge').hidden = DATA.source !== 'demo';
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
  const mail = { tipo, tipoLabel, nome: member.nome, destinatario: member.email, subject, html, when: new Date(), channel: 'demo' };
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
async function sendReminders() {
  const list = DATA.members.filter((m) => m.stato === 'In scadenza' && m.email && !reminded.has(m.sid));
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

function openSocioModal() {
  $('#f-piano').innerHTML = DATA.plans.map((p) => `<option value="${p.name}">${p.name} — ${euro(p.price)} · ${p.dur} mese/i</option>`).join('');
  $('#f-inizio').value = new Date().toISOString().slice(0, 10);
  $('#socioform').reset();
  $('#f-inizio').value = new Date().toISOString().slice(0, 10);
  $('#f-consenso').checked = true;
  openModal('modal-socio');
  setTimeout(() => $('#f-nome').focus(), 50);
}
async function submitSocio(e) {
  e.preventDefault();
  const nome = $('#f-nome').value.trim(), cognome = $('#f-cognome').value.trim();
  if (!nome || !cognome) return;
  const plan = DATA.plans.find((p) => p.name === $('#f-piano').value);
  const start = new Date($('#f-inizio').value || Date.now());
  const end = addMonths(start, plan.dur);
  const dleft = giorniTo(end);
  const member = {
    sid: 'new-' + Date.now(), id: nextTessera(), nome: `${nome} ${cognome}`,
    email: ($('#f-email').value.trim() || `${nome}.${cognome}`.toLowerCase().replace(/ /g, '') + '@email.it'),
    plan: { name: plan.name, price: plan.price, mcost: plan.mcost, dur: plan.dur, color: plan.color },
    start, end, dleft, stato: statoDa(dleft), av: AV[DATA.members.length % AV.length],
    consenso: $('#f-consenso').checked,
  };
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
  const ok = m.stato !== 'Scaduto';
  const now = new Date();
  DATA.accessi.unshift({
    time: now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    nome: m.nome, id: m.id, av: m.av, plan: m.plan.name, ing: $('#a-ingresso').value,
    ok, warnScad: m.stato === 'In scadenza',
  });
  $('#c-acc').textContent = DATA.accessi.length;
  renderAccessi();
  closeModal('modal-accesso');
  toast(ok ? `Accesso registrato · ${m.nome}` : `Accesso NEGATO · ${m.nome} (abbonamento scaduto)`, ok ? 'ok' : 'warn');
}

// ---------- rinnovo abbonamento ----------
let renewSid = null;
function renewBase(m) { const t = new Date(); t.setHours(0, 0, 0, 0); return new Date(m.end) >= t ? new Date(m.end) : t; }
function openRinnovoModal(sid) {
  const m = DATA.members.find((x) => x.sid === sid); if (!m) return;
  renewSid = sid;
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
async function doRenew(e) {
  e.preventDefault();
  const m = DATA.members.find((x) => x.sid === renewSid); if (!m) return;
  const plan = DATA.plans.find((p) => p.name === $('#r-piano').value);
  const newEnd = addMonths(renewBase(m), plan.dur);
  m.plan = { name: plan.name, price: plan.price, mcost: plan.mcost, dur: plan.dur, color: plan.color };
  m.end = newEnd; m.dleft = giorniTo(newEnd); m.stato = statoDa(m.dleft);
  reminded.delete(m.sid);                       // riabilita eventuali futuri promemoria
  DATA.revenue.at(-1).value += plan.price;      // incassa la quota nel mese corrente
  recomputePlans();
  renderAll();
  closeModal('modal-rinnovo');
  toast(`Abbonamento rinnovato · ${m.nome} → scad. ${fmtDate(newEnd)}`);
  if ($('#r-ricevuta').checked && m.email) {
    const { subject, html } = templates.ricevuta(m);
    const mail = await sendMail({ tipo: 'ricevuta', tipoLabel: 'Ricevuta', member: m, subject, html });
    toast(mail.channel === 'mailpit' ? `Ricevuta inviata a Mailpit · ${m.email}` : `Ricevuta generata (anteprima) · apri Posta`, 'mail');
  }
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
  if (!supa) return true; // demo mode
  const { data: { session } } = await supa.auth.getSession();
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
  $('#mempager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    const p = b.dataset.p; if (p === 'prev') memState.page--; else if (p === 'next') memState.page++; else memState.page = +p;
    renderMembers();
  });
  $('#burger').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
  $('#scrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); });
  $('#theme').addEventListener('click', () => {
    const r = document.documentElement;
    const cur = r.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    r.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  });

  // azioni demo
  $('#btn-nuovo').addEventListener('click', openSocioModal);
  $('#socioform').addEventListener('submit', submitSocio);
  $('#btn-accesso').addEventListener('click', openAccessoModal);
  $('#accessoform').addEventListener('submit', submitAccesso);
  $('#btn-reminders').addEventListener('click', sendReminders);
  $('#btn-clear-posta').addEventListener('click', clearPosta);
  $('#memtable tbody').addEventListener('click', (e) => { const b = e.target.closest('[data-renew]'); if (b) openRinnovoModal(b.dataset.renew); });
  $('#r-piano').addEventListener('change', updateRinnovoPreview);
  $('#rinnovoform').addEventListener('submit', doRenew);
  $('#posta tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) openMailPreview(+tr.dataset.i); });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) closeModal(o.id); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.overlay:not([hidden])').forEach((o) => closeModal(o.id)); });

  $('#loginform')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const supa = await getSupa();
    const err = $('#loginerr'); err.textContent = '';
    const { error } = await supa.auth.signInWithPassword({ email: $('#email').value, password: $('#pwd').value });
    if (error) { err.textContent = 'Accesso non riuscito: ' + error.message; return; }
    $('#login').hidden = true; boot();
  });
}

async function boot() {
  if (!(await ensureAuth())) return;
  DATA = await loadData();
  renderAll();
}

wireEvents();
boot();
