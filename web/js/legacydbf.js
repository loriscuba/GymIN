// Lettura nel browser dei file DBF del vecchio gestionale → righe "abbonamenti.csv".
// Porting della parte abbonamenti di tools/import-legacy/dbf_to_csv.py (stesse regole):
//   tessere.dbf  (obbligatorio) abbonamenti; esclusi i record tecnici "Ufficio"
//   anagraf.dbf  (opzionale)    esclude "Cliente generico" e codici non in anagrafica
//   cnt_bank.dbf (opzionale)    ricariche "N scatti" → entrate dei carnet
//   accessi.dbf  (opzionale)    accessi consumati → residuo ESATTO dei carnet
// I file restano nel browser: non vengono caricati da nessuna parte.

const dec = new TextDecoder('windows-1252');

// legge un DBF; `want` = elenco campi da estrarre (default tutti). I memo (M) non servono qui.
export function readDbf(buf, want) {
  const b = new Uint8Array(buf), v = new DataView(buf);
  const numrec = v.getUint32(4, true), hdrlen = v.getUint16(8, true), reclen = v.getUint16(10, true);
  const fields = [];
  for (let pos = 32, off = 1; b[pos] !== 0x0d && pos < hdrlen; pos += 32) {
    let name = ''; for (let k = 0; k < 11 && b[pos + k]; k++) name += String.fromCharCode(b[pos + k]);
    const f = { name, type: String.fromCharCode(b[pos + 11]), len: b[pos + 16], off };
    off += f.len;
    if (!want || want.includes(name)) fields.push(f);
  }
  const conv = (o, f) => {
    if (f.type === 'I' && f.len === 4) return String(v.getInt32(o, true));
    if (f.type === 'M') return '';
    const s = dec.decode(b.subarray(o, o + f.len)).trim();
    if (f.type === 'D') return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
    if (f.type === 'L') return /^[TY]$/i.test(s) ? '1' : '0';
    return s;
  };
  const rows = [];
  for (let r = 0; r < numrec; r++) {
    const base = hdrlen + r * reclen;
    if (base + reclen > b.length) break;
    if (b[base] === 0x2a) continue;   // '*' = record cancellato
    const d = {};
    for (const f of fields) d[f.name] = conv(base + f.off, f);
    rows.push(d);
  }
  return rows;
}

const RX_SCATTI = /Ricarica\s+(\d+)\s+scatt/i;
const RX_CLI = /^[A-Za-z]?(\d+)\s*-/;

function ricariche(rows) {
  const per = {};
  for (const r of rows) {
    const caus = r.CAUSALE || '';
    if (!caus.toLowerCase().includes('ricaric')) continue;
    const mc = RX_CLI.exec(r.BANCA || ''); if (!mc) continue;
    const cod = mc[1];
    const ms = RX_SCATTI.exec(caus); const scatti = ms ? +ms[1] : 0;
    const p = per[cod] || (per[cod] = { scatti: 0, ultima: '', ultimi: 0 });
    p.scatti += scatti;
    const dm = r.DATA_MOV || '';
    if (dm && dm >= p.ultima) { p.ultima = dm; if (scatti) p.ultimi = scatti; }
  }
  return per;
}

function consumati(rows) {
  const used = {};
  for (const r of rows) {
    if (!(r.SERVIZIO || '').toLowerCase().includes('ingress')) continue;
    const com = (r.COMMENTO || '').toLowerCase();
    if (com.includes('ignorat') || com.includes('negat')) continue;
    const cod = String(parseInt(r.COD_CLI, 10) || '');
    if (cod) used[cod] = (used[cod] || 0) + 1;
  }
  return used;
}

// files: FileList/array di File. Ritorna { rows, info } con rows nello stesso formato di abbonamenti.csv
export async function abbonamentiDaDbf(files) {
  const by = {};
  for (const f of files) by[f.name.toLowerCase()] = f;
  if (!by['tessere.dbf']) throw new Error('Manca tessere.dbf: selezionalo insieme agli altri file');
  const leggi = async (n, want) => (by[n] ? readDbf(await by[n].arrayBuffer(), want) : null);

  const tess = await leggi('tessere.dbf', ['COD_CLI', 'SERVIZIO', 'TIPO_SERV', 'G_INIZIO', 'G_FINE', 'DISABLED']);
  const anag = await leggi('anagraf.dbf', ['COD_CLI', 'NOME', 'COGNOME']);
  const cnt = await leggi('cnt_bank.dbf', ['CAUSALE', 'BANCA', 'DATA_MOV']);
  const acc = cnt && await leggi('accessi.dbf', ['SERVIZIO', 'COMMENTO', 'COD_CLI']);

  const generico = (r) => r.COGNOME.trim().toUpperCase() === 'CLIENTE' && r.NOME.toUpperCase().includes('GENERICO');
  const valid = anag && new Set(anag.filter((r) => !generico(r)).map((r) => r.COD_CLI.trim()));
  const ric = cnt ? ricariche(cnt) : {};
  if (acc) {
    const used = consumati(acc);
    for (const [cod, p] of Object.entries(ric)) p.residuo = Math.max(0, p.scatti - (used[cod] || 0));
  }

  const abb = [];
  for (const r of tess) {
    const serv = r.SERVIZIO.trim();
    if (!serv || serv === 'Ufficio' || serv === '\\') continue;
    const cod = r.COD_CLI.trim();
    if (valid && !valid.has(cod)) continue;
    if (!r.G_INIZIO && !r.G_FINE) continue;
    abb.push({
      cod_cli: cod, piano_nome: serv, tipo_serv: r.TIPO_SERV.trim(),
      data_inizio: r.G_INIZIO, data_scadenza: r.G_FINE,
      open_ended: r.G_FINE >= '2900-01-01' ? 'true' : 'false',
      entrate_residue: '', disabilitato: r.DISABLED === '1' ? 'true' : 'false',
    });
  }
  // abbonamento più recente per socio (data_scadenza massima)
  const latest = {};
  abb.forEach((a, i) => { const k = a.cod_cli; if (!(k in latest) || (a.data_scadenza || '0000') > (abb[latest[k]].data_scadenza || '0000')) latest[k] = i; });
  abb.forEach((a, i) => {
    a.is_latest = latest[a.cod_cli] === i ? '1' : '0';
    if (a.is_latest === '1' && a.piano_nome.toLowerCase().includes('ingress')) {
      const p = ric[a.cod_cli];
      if (p) a.entrate_residue = 'residuo' in p ? String(p.residuo) : p.ultimi ? String(p.ultimi) : '';
    }
  });
  const usati = ['tessere.dbf', anag && 'anagraf.dbf', cnt && 'cnt_bank.dbf', acc && 'accessi.dbf'].filter(Boolean);
  return { rows: abb, info: `${usati.join(', ')}${acc ? ' · residuo carnet esatto' : cnt ? ' · residuo carnet stimato' : ''}` };
}
