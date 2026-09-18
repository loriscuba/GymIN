// GymIN · importatore dati legacy in Supabase.
//
// Legge i CSV prodotti da dbf_to_csv.py (soci.csv, piani.csv, abbonamenti.csv)
// e li carica nelle tabelle soci / piani / abbonamenti.
//
// Idempotente:
//   - piani  -> inseriti solo se il nome non esiste gia
//   - soci   -> upsert su cod_cli (chiave del vecchio gestionale)
//   - abbonamenti -> per default un solo abbonamento "corrente" per socio
//                    (is_latest); con --replace gli abbonamenti esistenti dei
//                    soci importati vengono prima rimossi.
//
// Richiede le stesse variabili del mailer:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (la service_role bypassa la RLS)
//
// Esempi:
//   node import.mjs --dir ./data/out --dry-run
//   node import.mjs --dir ./data/out                 # abbonamento corrente per socio
//   node import.mjs --dir ./data/out --all-history   # tutto lo storico abbonamenti
//   node import.mjs --dir ./data/out --replace       # sovrascrive gli abbonamenti dei soci
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ---- argomenti -------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name) => args.includes(name);
const val = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DIR = val('--dir', './data/out');
const DRY = opt('--dry-run');
const ALL_HISTORY = opt('--all-history');
const REPLACE = opt('--replace');
const CHUNK = 500;

// ---- client ----------------------------------------------------------------
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✖  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti nel .env');
  process.exit(1);
}
const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// ---- CSV minimale (gestisce virgolette e newline nei campi) ----------------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignora */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].length))
             .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
const readCSV = (name) => parseCSV(fs.readFileSync(path.join(DIR, name), 'utf-8'));
const nz = (v) => (v && v.trim() !== '' ? v.trim() : null);           // '' -> null
const dz = (v) => { const s = nz(v); return s && s >= '1900-01-01' && s < '2900-01-01' ? s : null; };
const addMonths = (iso, m) => { const d = new Date(iso); d.setMonth(d.getMonth() + (m || 1)); return d.toISOString().slice(0, 10); };

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

async function main() {
  console.log(`GymIN import · dir=${DIR}${DRY ? ' · DRY-RUN' : ''}${ALL_HISTORY ? ' · all-history' : ' · latest-only'}${REPLACE ? ' · replace' : ''}`);
  const soci = readCSV('soci.csv');
  const piani = readCSV('piani.csv');
  const abbonamenti = readCSV('abbonamenti.csv');
  console.log(`CSV letti: soci=${soci.length} piani=${piani.length} abbonamenti=${abbonamenti.length}`);

  // ---- 1) PIANI ------------------------------------------------------------
  const { data: existingPiani, error: ep } = await supa.from('piani').select('id,nome');
  if (ep) throw ep;
  const planId = new Map((existingPiani || []).map((p) => [p.nome, p.id]));
  const nuoviPiani = piani.filter((p) => !planId.has(p.nome)).map((p) => ({
    nome: p.nome,
    prezzo: Number(p.prezzo) || 0,
    durata_mesi: Number(p.durata_mesi) || 1,
    entrate: Number(p.entrate) || 0,
    descrizione: nz(p.descrizione),
    attivo: p.attivo !== 'false',
  }));
  if (nuoviPiani.length && !DRY) {
    const { data, error } = await supa.from('piani').insert(nuoviPiani).select('id,nome');
    if (error) throw error;
    for (const p of data) planId.set(p.nome, p.id);
  }
  console.log(`Piani: ${nuoviPiani.length} nuovi, ${planId.size} totali disponibili`);
  const planMeta = new Map(piani.map((p) => [p.nome, { durata: Number(p.durata_mesi) || 1, entrate: Number(p.entrate) || 0 }]));

  // ---- 2) SOCI (upsert su cod_cli) -----------------------------------------
  // Evita conflitti sull'unique email: la prima occorrenza tiene l'email,
  // le successive con la stessa email la lasciano vuota.
  const emailSeen = new Set();
  const sociRows = soci.map((s) => {
    let email = nz(s.email)?.toLowerCase() || null;
    if (email) { if (emailSeen.has(email)) email = null; else emailSeen.add(email); }
    return {
      cod_cli: nz(s.cod_cli),
      tessera: nz(s.tessera),
      nome: s.nome || '—',
      cognome: s.cognome || '—',
      email,
      telefono: nz(s.telefono),
      data_nascita: dz(s.data_nascita),
      sesso: nz(s.sesso),
      codice_fiscale: nz(s.codice_fiscale),
      indirizzo: nz(s.indirizzo),
      citta: nz(s.citta),
      cap: nz(s.cap),
      provincia: nz(s.provincia),
      consenso_mail: s.consenso_mail === 'true',
      note: nz(s.note),
    };
  });
  if (!DRY) {
    for (const part of chunk(sociRows, CHUNK)) {
      const { error } = await supa.from('soci').upsert(part, { onConflict: 'cod_cli' });
      if (error) throw error;
    }
  }
  // rileggi id per collegare gli abbonamenti
  const socioId = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa.from('soci').select('id,cod_cli').not('cod_cli', 'is', null).range(from, from + 999);
    if (error) throw error;
    for (const r of data) socioId.set(r.cod_cli, r.id);
    if (!data.length || data.length < 1000) break;
  }
  console.log(`Soci: ${sociRows.length} nel CSV, ${DRY ? '(dry-run)' : socioId.size + ' con id in DB'}`);

  // ---- 3) ABBONAMENTI ------------------------------------------------------
  let righe = ALL_HISTORY ? abbonamenti : abbonamenti.filter((a) => a.is_latest === '1');
  const today = new Date().toISOString().slice(0, 10);
  const abbRows = [];
  let skipNoSocio = 0, skipNoPiano = 0;
  for (const a of righe) {
    const sid = socioId.get(a.cod_cli);
    const pid = planId.get(a.piano_nome);
    // In dry-run il DB puo essere vuoto: non scartiamo, contiamo solo le righe.
    if (!DRY && !sid) { skipNoSocio++; continue; }
    if (!DRY && !pid) { skipNoPiano++; continue; }
    const meta = planMeta.get(a.piano_nome) || { durata: 1, entrate: 0 };
    const inizio = dz(a.data_inizio) || today;
    let scad = dz(a.data_scadenza);
    if (!scad) scad = addMonths(inizio, meta.durata);           // open-ended (3000) o vuota
    abbRows.push({
      socio_id: sid,
      piano_id: pid,
      data_inizio: inizio,
      data_scadenza: scad,
      entrate_residue: meta.entrate > 0 ? meta.entrate : null,   // carnet: crediti pieni (da verificare)
      stato: a.disabilitato === 'true' ? 'disdetto' : (scad < today ? 'scaduto' : 'attivo'),
    });
  }
  console.log(`Abbonamenti da importare: ${abbRows.length} (saltati: ${skipNoSocio} senza socio, ${skipNoPiano} senza piano)`);

  if (!DRY) {
    if (REPLACE) {
      const ids = [...new Set(abbRows.map((r) => r.socio_id))];
      for (const part of chunk(ids, CHUNK)) {
        const { error } = await supa.from('abbonamenti').delete().in('socio_id', part);
        if (error) throw error;
      }
      console.log(`  (replace) rimossi gli abbonamenti esistenti di ${ids.length} soci`);
    }
    for (const part of chunk(abbRows, CHUNK)) {
      const { error } = await supa.from('abbonamenti').insert(part);
      if (error) throw error;
    }
  }

  console.log(DRY ? '\nDRY-RUN completato: nessuna scrittura effettuata.' : '\nImport completato.');
}

main().catch((e) => { console.error('✖ Import fallito:', e.message || e); process.exit(1); });
