// GymIN · import automatico degli abbonamenti dalla cartella condivisa.
//
// Fa da solo quello che il cruscotto "Import abbonamenti" fa a mano: legge tessere.dbf
// (+ anagraf.dbf) del vecchio gestionale, confronta col DB e importa tutte le righe
// "Nuovo" e "Diverso" (stesse regole: web/js/legacydbf.js + web/js/importlogic.js).
// Solo abbonamento corrente per socio; non crea soci né piani (righe "Socio/Piano
// mancante" restano da gestire a mano nel cruscotto).
//
// Le regole (legacydbf.js, importlogic.js) si scaricano a ogni avvio dall'app pubblicata
// (GYMIN_WEB_URL, default GitHub Pages): sul PC bastano questo file e package.json.
// Con --local si usano invece i file di web/js del repo.
//
// Richiede nel .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (come import.mjs).
//
// Esempi:
//   node auto-import.mjs --dir \\172.16.0.155\Condivisa --dry-run   # solo anteprima
//   node auto-import.mjs --dir \\172.16.0.155\Condivisa             # importa
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const val = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const DIR = val('--dir', process.env.GYMIN_IMPORT_DIR);
const DRY = args.includes('--dry-run');
const WEB = process.env.GYMIN_WEB_URL || 'https://loriscuba.github.io/GymIN/js/';
const log = (m) => console.log(`[${new Date().toLocaleString('it-IT')}] ${m}`);

async function fetchAll(supa, table, select, modify = (q) => q) {
  let out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await modify(supa.from(table).select(select)).order('id').range(from, from + 999);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) return out;
  }
}

// modulo dell'app: dal repo con --local, altrimenti scaricato dall'app pubblicata
async function modulo(nome) {
  if (args.includes('--local')) return import(new URL(`../../web/js/${nome}`, import.meta.url));
  const res = await fetch(`${WEB}${nome}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`download ${WEB}${nome} fallito (HTTP ${res.status})`);
  return import(`data:text/javascript,${encodeURIComponent(await res.text())}`);
}

// i file DBF come oggetti "File" (name + arrayBuffer), come li passa il browser
function fileDbf(nome) {
  const p = path.join(DIR, nome);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  return { name: nome, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}

// righe non importabili (socio/piano mancante) in un CSV per Excel, accanto allo script.
// Contiene nomi di soci: resta su questo PC, non va condiviso.
function scriviReport(rows) {
  const motivo = { nosocio: 'Socio mancante', nopiano: 'Piano mancante' };
  const dt = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const cella = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const righe = rows.filter((r) => motivo[r.stato])
    .map((r) => { const g = r.anag || {};
      return [motivo[r.stato], r.cod, r.vecchio, dt(g.nascita), g.cf, g.telefono, g.email, g.citta, r.socio || r.candidato || '',
        r.piano, dt(r.inizioFile), r.scadFile ? dt(r.scadFile) : 'senza scadenza'].map(cella).join(';'); });
  const file = new URL('./da-verificare.csv', import.meta.url);
  const head = ['Motivo', 'Codice cliente', 'Nome vecchio gestionale', 'Data nascita', 'Codice fiscale', 'Telefono', 'Email', 'Città',
    'Socio in GymIN (o possibile corrispondenza)', 'Piano', 'Inizio', 'Scadenza'].join(';');
  fs.writeFileSync(file, `\uFEFF${[head, ...righe].join('\r\n')}\r\n`);
  log(`righe da verificare: ${righe.length} → ${path.basename(file.pathname)}`);
}

async function main() {
  if (!DIR) throw new Error('cartella mancante: usa --dir <cartella> oppure GYMIN_IMPORT_DIR nel .env');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti nel .env');
  const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ abbonamentiDaDbf }, { confronta, applica, IMPORTABILI }] = await Promise.all([modulo('legacydbf.js'), modulo('importlogic.js')]);

  const files = ['tessere.dbf', 'anagraf.dbf'].map(fileDbf).filter(Boolean);
  const { rows: csvRows, info } = await abbonamentiDaDbf(files);
  log(`${DIR} · ${info} · ${csvRows.length} abbonamenti${DRY ? ' · DRY-RUN' : ''}`);

  const [soci, piani, abb] = await Promise.all([
    fetchAll(supa, 'soci', 'id,cod_cli,nome,cognome,codice_fiscale'),
    fetchAll(supa, 'piani', 'id,nome,durata_mesi,entrate'),
    fetchAll(supa, 'abbonamenti', 'id,socio_id,piano_id,data_inizio,data_scadenza,entrate_residue,stato'),
  ]);
  const rows = confronta(csvRows, { soci, piani, abb });
  const conta = (s) => rows.filter((r) => r.stato === s).length;
  log(`nuovi ${conta('nuovo')} · diversi ${conta('diverso')} · già presenti ${conta('presente')} · socio mancante ${conta('nosocio')} · piano mancante ${conta('nopiano')}`);

  scriviReport(rows);

  const scelte = rows.filter((r) => IMPORTABILI.has(r.stato));
  if (DRY || !scelte.length) { log(DRY ? 'DRY-RUN: nessuna scrittura' : 'Niente da importare'); return; }
  const { ok, ko, errori } = await applica(supa, scelte);
  errori.forEach((m) => log(`errore: ${m}`));
  log(`Importati ${ok}, errori ${ko}`);
  if (ko) process.exitCode = 1;
}

main().catch((e) => { log(`✖ Import fallito: ${e.message || e}`); process.exitCode = 1; });
