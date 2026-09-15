// Livello dati GymIN.
// - Se Supabase è configurato (web/config.js) e c'è una sessione, legge dal DB.
// - Altrimenti genera dati demo coerenti (stessa forma dei dati reali).
let _supa;
let _tried = false;
// Carica il client Supabase SOLO se configurato, con import dinamico:
// così la modalità demo non dipende dalla rete e parte sempre.
export async function getSupa() {
  if (_tried) return _supa;
  _tried = true;
  const cfg = window.GYMIN_CONFIG || {};
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      _supa = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('Supabase non caricato, uso la modalità demo:', e);
      _supa = null;
    }
  } else {
    _supa = null;
  }
  return _supa;
}

export const PLAN_COLORS = {
  'Open Mese': 'var(--accent)', 'Trimestrale': 'var(--blue)', 'Annuale': 'var(--teal)',
  'Student': 'var(--violet)', 'Personal 10': 'var(--slate)',
};
const AV = ['#f4511e', '#2563eb', '#0d9488', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#4f46e5'];
const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const initials = (n) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const giorni = (a, b) => Math.round((a - b) / 86400000);
function statoDa(dleft) {
  return dleft < 0 ? 'Scaduto' : dleft <= 30 ? 'In scadenza' : 'Attivo';
}
function planMeta(nome, prezzo, durata) {
  const dur = durata || 1;
  return { name: nome, price: Number(prezzo), dur, mcost: Number(prezzo) / dur, color: PLAN_COLORS[nome] || 'var(--slate)' };
}

// ---------------------------------------------------------------------------
// SUPABASE
// ---------------------------------------------------------------------------
async function loadSupabase(supa) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const { data: abb, error } = await supa
    .from('abbonamenti')
    .select('id,data_inizio,data_scadenza,socio:soci(id,nome,cognome,email,tessera),piano:piani(nome,prezzo,durata_mesi)');
  if (error) throw error;

  const members = abb.filter((a) => a.socio).map((a, i) => {
    const end = new Date(a.data_scadenza);
    const dleft = giorni(end, today);
    const nome = `${a.socio.nome} ${a.socio.cognome}`;
    return {
      sid: a.socio.id, id: a.socio.tessera || a.socio.id.slice(0, 8), nome, email: a.socio.email || '',
      plan: planMeta(a.piano?.nome || '—', a.piano?.prezzo || 0, a.piano?.durata_mesi || 1),
      start: new Date(a.data_inizio), end, dleft, stato: statoDa(dleft), av: AV[i % AV.length],
    };
  });
  const bySid = Object.fromEntries(members.map((m) => [m.sid, m]));

  // accessi di oggi
  const start = today.toISOString();
  const { data: acc } = await supa
    .from('accessi')
    .select('registrato_il,ingresso,esito,socio:soci(id,nome,cognome,tessera)')
    .gte('registrato_il', start).order('registrato_il', { ascending: false }).limit(40);
  const accessi = (acc || []).filter((a) => a.socio).map((a) => {
    const m = bySid[a.socio.id];
    const d = new Date(a.registrato_il);
    return {
      time: d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      nome: `${a.socio.nome} ${a.socio.cognome}`, id: a.socio.tessera || '', av: (m && m.av) || AV[0],
      plan: m ? m.plan.name : '—', ing: a.ingresso,
      ok: a.esito === 'valido', warnScad: m ? m.stato === 'In scadenza' : false,
    };
  });

  // fatturato ultimi 12 mesi da pagamenti
  const from = new Date(today); from.setMonth(from.getMonth() - 11); from.setDate(1);
  const { data: pag } = await supa.from('pagamenti').select('importo,data').gte('data', from.toISOString());
  const revenue = build12Months(today);
  for (const p of pag || []) {
    const d = new Date(p.data);
    const k = d.getFullYear() * 12 + d.getMonth();
    const hit = revenue.find((r) => r.key === k);
    if (hit) hit.value += Number(p.importo);
  }

  return finalize(members, accessi, revenue, 'supabase');
}

function build12Months(today) {
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({ key: d.getFullYear() * 12 + d.getMonth(), label: MESI[d.getMonth()], value: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// DEMO (nessuna configurazione richiesta)
// ---------------------------------------------------------------------------
function loadDemo() {
  let seed = 20260915;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const nomi = ['Marco', 'Giulia', 'Luca', 'Sara', 'Andrea', 'Chiara', 'Matteo', 'Francesca', 'Davide', 'Elena', 'Simone', 'Martina', 'Alessandro', 'Valentina', 'Federico', 'Alice', 'Lorenzo', 'Giorgia', 'Riccardo', 'Aurora', 'Gabriele', 'Sofia', 'Tommaso', 'Beatrice', 'Stefano', 'Noemi', 'Nicola', 'Ilaria', 'Paolo', 'Greta'];
  const cognomi = ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone'];
  const PLANS = [
    { name: 'Open Mese', price: 59, dur: 1, w: .20 }, { name: 'Trimestrale', price: 159, dur: 3, w: .18 },
    { name: 'Annuale', price: 499, dur: 12, w: .30 }, { name: 'Student', price: 39, dur: 1, w: .17 },
    { name: 'Personal 10', price: 350, dur: 4, w: .15 },
  ];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const members = [];
  for (let i = 0; i < 90; i++) {
    const nome = pick(nomi) + ' ' + pick(cognomi);
    let acc = 0, pr = rnd(), P = PLANS[0];
    for (const p of PLANS) { acc += p.w; if (pr <= acc) { P = p; break; } }
    let start = new Date(today); start.setDate(start.getDate() - Math.floor(rnd() * 400));
    let end = new Date(start); end.setMonth(end.getMonth() + P.dur);
    while (end < today && rnd() < 0.72) { start = new Date(end); end.setMonth(end.getMonth() + P.dur); }
    const dleft = giorni(end, today);
    members.push({
      sid: 'demo-' + i, id: 'GY-' + (1200 + i), nome,
      email: nome.toLowerCase().replace(/ /g, '.') + i + '@email.it',
      plan: planMeta(P.name, P.price, P.dur), start, end, dleft, stato: statoDa(dleft), av: AV[i % AV.length],
    });
  }
  // accessi
  const accessi = [];
  let t = 7 * 60 + 5;
  for (let i = 0; i < 14; i++) {
    t += Math.floor(rnd() * 34) + 6;
    const m = members[Math.floor(rnd() * members.length)];
    accessi.push({
      time: String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'),
      nome: m.nome, id: m.id, av: m.av, plan: m.plan.name, ing: pick(['Tornello A', 'Tornello B', 'Reception']),
      ok: m.stato !== 'Scaduto', warnScad: m.stato === 'In scadenza',
    });
  }
  accessi.reverse();
  // fatturato demo: incassi mensili con stagionalità
  const base = [15200, 11800, 9600, 16400, 17100, 18200, 19600, 21400, 22850, 14200, 15100, 16800];
  const revenue = build12Months(today).map((r, i) => ({ ...r, value: base[i % 12] }));
  return finalize(members, accessi, revenue, 'demo');
}

// ---------------------------------------------------------------------------
function finalize(members, accessi, revenue, source) {
  const names = [...new Set(members.map((m) => m.plan.name))];
  const plans = (Object.keys(PLAN_COLORS).filter((n) => names.includes(n)).concat(names.filter((n) => !PLAN_COLORS[n])))
    .map((name) => {
      const list = members.filter((m) => m.plan.name === name);
      return {
        name, color: PLAN_COLORS[name] || 'var(--slate)',
        price: list[0]?.plan.price || 0, mcost: list[0]?.plan.mcost || 0, dur: list[0]?.plan.dur || 1,
        count: list.length, active: list.filter((m) => m.stato === 'Attivo').length,
      };
    });
  return { source, members, accessi, revenue, plans };
}

export async function loadData() {
  const supa = await getSupa();
  if (supa) {
    const { data: { session } } = await supa.auth.getSession();
    if (session) return loadSupabase(supa);
  }
  return loadDemo();
}
