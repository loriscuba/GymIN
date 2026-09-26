import { privacyFromRow } from './privacy.js?v=__BUILD__';

// Livello dati GymIN.
// L'app usa sempre Supabase: se la config o la sessione non sono valide,
// il codice deve bloccare il caricamento invece di generare dati demo.
let _supa;
let _tried = false;

export async function getSupa() {
  if (_tried) return _supa;
  _tried = true;
  const cfg = window.GYMIN_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    _supa = null;
    return null;
  }

  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    // DB_SCHEMA: 'test' nell'ambiente di test (stesso progetto Supabase, tabelle nello schema test)
    _supa = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, cfg.DB_SCHEMA ? { db: { schema: cfg.DB_SCHEMA } } : undefined);
  } catch (e) {
    console.error('Supabase non caricato:', e);
    _supa = null;
  }
  return _supa;
}

export const PLAN_COLORS = {
  'Open Mese': 'var(--accent)', 'Trimestrale': 'var(--blue)', 'Annuale': 'var(--teal)',
  'Student': 'var(--violet)', 'Personal 10': 'var(--slate)', 'Carnet 5 entrate': '#0891b2',
};
const AV = ['#f4511e', '#2563eb', '#0d9488', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#4f46e5'];
const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const initials = (n) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const giorni = (a, b) => Math.round((a - b) / 86400000);
function statoDa(dleft) {
  return dleft < 0 ? 'Scaduto' : dleft <= 31 ? 'In scadenza' : 'Attivo';
}
function planMeta(nome, prezzo, durata, entrate, extra = {}) {
  const dur = durata || 1;
  return {
    id: extra.id || null,
    name: nome,
    price: Number(prezzo),
    dur,
    mcost: Number(prezzo) / dur,
    color: PLAN_COLORS[nome] || 'var(--slate)',
    entrate: Number(entrate) || 0,
    active: extra.active !== false,
    descrizione: extra.descrizione || '',
  };
}
// stato tenendo conto dei carnet (a consumo) oltre alle date
function statoMembro(plan, dleft, entrateResidue) {
  if (plan.entrate) return entrateResidue <= 0 ? 'Scaduto' : entrateResidue <= 1 ? 'In scadenza' : 'Attivo';
  return statoDa(dleft);
}

// ---------------------------------------------------------------------------
// SUPABASE
// ---------------------------------------------------------------------------
// Legge TUTTE le righe di una tabella/select, aggirando il limite di 1000
// righe per richiesta di Supabase (paginazione con range()).
export async function fetchAll(supa, table, select, modify = (q) => q) {
  const PAGE = 1000;
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await modify(supa.from(table).select(select)).range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function loadSupabase(supa) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Tutti i soci (anche quelli senza abbonamento) + tutti gli abbonamenti.
  const soci = await fetchAll(supa, 'soci',
    'id,nome,cognome,email,telefono,data_nascita,sesso,codice_fiscale,indirizzo,citta,cap,note,consenso_mail,tessera,creato_il,' +
    'privacy_acknowledged,privacy_acknowledged_at,privacy_policy_version,marketing_email_consent,marketing_email_consent_at,marketing_email_revoked_at');
  const abb = await fetchAll(supa, 'abbonamenti',
    'id,socio_id,data_inizio,data_scadenza,entrate_residue,stato,piano:piani(nome,prezzo,durata_mesi,entrate)');
  const planCatalog = await fetchAll(supa, 'piani', 'id,nome,prezzo,durata_mesi,entrate,descrizione,attivo');

  // Ultimo abbonamento per socio (data_scadenza massima). Gli archiviati (soci inattivi) sono ignorati.
  const lastBySocio = {};
  for (const a of abb) {
    if (a.stato === 'archiviato') continue;
    const cur = lastBySocio[a.socio_id];
    if (!cur || new Date(a.data_scadenza) > new Date(cur.data_scadenza)) lastBySocio[a.socio_id] = a;
  }

  const members = soci.map((s, i) => {
    const nome = `${s.nome} ${s.cognome}`;
    const base = {
      sid: s.id, id: s.tessera || s.id.slice(0, 8), nome, firstName: s.nome, lastName: s.cognome,
      email: s.email || '', telefono: s.telefono, dataNascita: s.data_nascita, sesso: s.sesso,
      cf: s.codice_fiscale, indirizzo: s.indirizzo, citta: s.citta, cap: s.cap,
      note: s.note, consenso: s.consenso_mail, ...privacyFromRow(s), av: AV[i % AV.length],
    };
    const a = lastBySocio[s.id];
    if (!a) {
      // socio in anagrafica ma senza alcun abbonamento
      return {
        ...base, plan: planMeta('—', 0, 1, 0), entrateResidue: undefined,
        start: s.creato_il ? new Date(s.creato_il) : null, end: null, dleft: null,
        stato: 'Senza abbonamento',
      };
    }
    const end = new Date(a.data_scadenza);
    const dleft = giorni(end, today);
    const plan = planMeta(a.piano?.nome || '—', a.piano?.prezzo || 0, a.piano?.durata_mesi || 1, a.piano?.entrate || 0);
    const entrateResidue = plan.entrate ? (a.entrate_residue ?? plan.entrate) : undefined;
    return {
      ...base, plan, entrateResidue,
      start: new Date(a.data_inizio), end, dleft, stato: statoMembro(plan, dleft, entrateResidue),
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

  // fatturato ultimi 12 mesi da pagamenti; fallback da piani attivi
  const from = new Date(today); from.setMonth(from.getMonth() - 11); from.setDate(1);
  const { data: pag } = await supa.from('pagamenti').select('importo,data').gte('data', from.toISOString());
  let revenue = build12Months(today);
  for (const p of pag || []) {
    const d = new Date(p.data);
    const k = d.getFullYear() * 12 + d.getMonth();
    const hit = revenue.find((r) => r.key === k);
    if (hit) hit.value += Number(p.importo);
  }
  const totalPagamenti = (pag || []).reduce((sum, p) => sum + Number(p.importo || 0), 0);
  if ((pag || []).length === 0 || totalPagamenti === 0) {
    const fallback = revenueFromActivePlans(members, today);
    if (fallback.at(-1)?.value > 0) revenue = fallback;
  }

  const planMap = new Map((planCatalog || []).filter((p) => p && p.nome).map((p) => [p.nome, planMeta(p.nome, p.prezzo ?? 0, p.durata_mesi ?? 1, p.entrate ?? 0, { id: p.id, active: p.attivo !== false, descrizione: p.descrizione || '' })]));
  for (const m of members) {
    if (m.plan && m.plan.name && m.plan.name !== '—' && !planMap.has(m.plan.name)) {
      planMap.set(m.plan.name, { ...m.plan, active: true, descrizione: '' });
    }
  }

  return finalize(members, accessi, revenue, 'supabase', [...planMap.values()]);
}

function build12Months(today) {
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({ key: d.getFullYear() * 12 + d.getMonth(), label: MESI[d.getMonth()], value: 0 });
  }
  return out;
}

function revenueFromActivePlans(members, today) {
  const revenue = build12Months(today);
  const current = revenue.at(-1);
  for (const m of members) {
    if (!m.plan || m.plan.name === '—') continue;
    if (m.stato === 'Attivo' || m.stato === 'In scadenza') {
      current.value += Number(m.plan.price || 0);
    }
  }
  return revenue;
}

// ---------------------------------------------------------------------------
function finalize(members, accessi, revenue, source, planCatalog = []) {
  const catalogByName = new Map((planCatalog || []).map((p) => [p.name, p]));
  const names = [...new Set([
    ...members.map((m) => m.plan.name),
    ...(planCatalog || []).map((p) => p.name),
  ])].filter((n) => n && n !== '—');
  const plans = (Object.keys(PLAN_COLORS).filter((n) => names.includes(n)).concat(names.filter((n) => !PLAN_COLORS[n])))
    .map((name) => {
      const list = members.filter((m) => m.plan.name === name);
      const planDef = catalogByName.get(name) || {
        name, color: PLAN_COLORS[name] || 'var(--slate)',
        price: list[0]?.plan.price || 0, mcost: list[0]?.plan.mcost || 0, dur: list[0]?.plan.dur || 1, entrate: list[0]?.plan.entrate || 0,
        active: true, descrizione: '', id: null,
      };
      return {
        id: planDef.id || null,
        name,
        color: planDef.color || PLAN_COLORS[name] || 'var(--slate)',
        price: Number(planDef.price ?? list[0]?.plan.price ?? 0),
        mcost: Number(planDef.mcost ?? planDef.price / (planDef.dur || 1) ?? 0),
        dur: Number(planDef.dur ?? list[0]?.plan.dur ?? 1),
        entrate: Number(planDef.entrate ?? list[0]?.plan.entrate ?? 0),
        descrizione: planDef.descrizione || '',
        attivo: planDef.active !== false,
        count: list.length,
        active: list.filter((m) => m.stato === 'Attivo').length,
      };
    });
  return { source, members, accessi, revenue, plans };
}

export async function loadData() {
  const supa = await getSupa();
  if (!supa) {
    throw new Error('Nessuna configurazione Supabase trovata. Verifica il file config.js e le variabili del deploy.');
  }

  const { data: { session }, error } = await supa.auth.getSession();
  if (error) throw error;
  if (!session) {
    throw new Error('Sessione non autenticata. Esegui il login prima di aprire il gestionale.');
  }

  return loadSupabase(supa);
}
