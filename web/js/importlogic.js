// Regole dell'import abbonamenti, condivise da web/js/importa.js (cruscotto nel browser)
// e tools/import-legacy/auto-import.mjs (import automatico pianificato): stesso confronto,
// stesse scritture. Scrive solo su abbonamenti e su soci.aggiornato_da_import.
export const IMPORTABILI = new Set(['nuovo', 'diverso']);
const CHUNK = 500;

const nz = (v) => (v && v.trim() !== '' ? v.trim() : null);
const dz = (v) => { const s = nz(v); return s && s >= '1900-01-01' && s < '2900-01-01' ? s : null; };
const addMonths = (iso, m) => { const d = new Date(iso); d.setMonth(d.getMonth() + (m || 1)); return d.toISOString().slice(0, 10); };

// per i soci non collegati: possibile socio GymIN con lo stesso codice fiscale o cognome+nome
// (es. già presente ma senza codice cliente). Ritorna (riga) => socio | undefined
const nomeKey = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const nomeSocio = (s) => `${s.cognome} ${s.nome}`.replace(/\s+/g, ' ').trim();
export function indiceCandidati(soci) {
  const byCf = new Map(soci.filter((s) => s.codice_fiscale).map((s) => [s.codice_fiscale.trim().toUpperCase(), s]));
  const byNome = new Map(soci.map((s) => [nomeKey(nomeSocio(s)), s]));
  return ({ cf, nominativo }) => (cf && byCf.get(String(cf).toUpperCase())) || (nominativo && byNome.get(nomeKey(nominativo))) || undefined;
}
const descrivi = (s) => (s ? `${nomeSocio(s)} (${s.cod_cli ? `cod. ${s.cod_cli}` : 'senza codice cliente'})` : '');

// confronta le righe di abbonamenti.csv (o da DBF) con soci/piani/abbonamenti del DB (solo calcoli)
export function confronta(csvRows, { soci, piani, abb }, { soloCorrenti = true, today = new Date().toISOString().slice(0, 10) } = {}) {
  const socioBy = new Map(soci.filter((s) => s.cod_cli).map((s) => [String(s.cod_cli).trim(), s]));
  const candidato = indiceCandidati(soci);
  const pianoBy = new Map(piani.map((p) => [p.nome, p]));
  const abbBy = new Map();   // socio|piano -> abbonamenti esistenti
  for (const a of abb) {
    const k = `${a.socio_id}|${a.piano_id}`;
    (abbBy.get(k) || abbBy.set(k, []).get(k)).push(a);
  }
  const src = soloCorrenti ? csvRows.filter((a) => a.is_latest === '1') : csvRows;

  const visti = new Set();   // righe doppie nel CSV: si importa solo la prima
  return src.map((a, i) => {
    const s = socioBy.get(String(a.cod_cli).trim());
    const p = pianoBy.get(a.piano_nome);
    // anno di scadenza per il filtro (righe non collegate: dalla data del file; senza scadenza: dall'inizio)
    const anno = (dz(a.data_scadenza) || dz(a.data_inizio) || '').slice(0, 4);
    // vecchio: nominativo da anagraf.dbf, per riconoscere i soci non collegati
    const r = { i, cod: a.cod_cli, piano: a.piano_nome, socio: s ? `${s.cognome} ${s.nome}` : '', vecchio: a.nominativo || '',
      inizioFile: dz(a.data_inizio), scadFile: dz(a.data_scadenza), anno };
    if (!s) {
      const anag = { nascita: dz(a.v_nascita), cf: a.v_cf || '', telefono: a.v_telefono || '', email: a.v_email || '', citta: a.v_citta || '' };
      return { ...r, stato: 'nosocio', anag, candidato: descrivi(candidato({ cf: a.v_cf, nominativo: a.nominativo })), riga: a };
    }
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
    r.anno = scad.slice(0, 4);
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
}

// scrive le righe scelte (nuove → insert, diverse → update) e segna i soci col badge UP
export async function applica(supa, scelte, onProgress = () => {}) {
  const nuovi = scelte.filter((r) => r.stato === 'nuovo');
  const agg = scelte.filter((r) => r.stato === 'diverso');
  let ok = 0, ko = 0;
  const errori = [];
  const toccati = new Set();
  for (let k = 0; k < nuovi.length; k += CHUNK) {
    const part = nuovi.slice(k, k + CHUNK);
    const { error } = await supa.from('abbonamenti').insert(part.map((r) => r.nuovo));
    if (error) { ko += part.length; errori.push(error.message); } else { ok += part.length; part.forEach((r) => toccati.add(r.nuovo.socio_id)); }
  }
  for (const r of agg) {
    onProgress(ok + ko + 1, scelte.length);
    const { error } = await supa.from('abbonamenti').update(r.diff).eq('id', r.ex.id);
    if (error) { ko++; errori.push(error.message); } else { ok++; toccati.add(r.ex.socio_id); }
  }
  const ids = [...toccati], now = new Date().toISOString();
  for (let k = 0; k < ids.length; k += CHUNK) {
    const { error } = await supa.from('soci').update({ aggiornato_da_import: now }).in('id', ids.slice(k, k + CHUNK));
    if (error) errori.push(error.message);
  }
  return { ok, ko, errori };
}
