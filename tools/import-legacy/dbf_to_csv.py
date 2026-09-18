#!/usr/bin/env python3
"""GymIN · convertitore dati legacy (DBF/FoxPro) -> CSV puliti per l'import.

Legge l'anagrafica e le tessere del vecchio gestionale (file .dbf con memo .fpt)
e produce tre CSV mappati sullo schema GymIN:
  - soci.csv        (tabella soci)
  - piani.csv       (tabella piani, dedotti dalle tessere)
  - abbonamenti.csv (tabella abbonamenti, dalle tessere; collegati via cod_cli)

Nessuna dipendenza esterna: parser DBF/FPT minimale incluso.

Uso:
  python3 dbf_to_csv.py --in ./data --out ./data/out
dove ./data contiene: anagraf.dbf, anagraf.fpt, tessere.dbf

I file di input e i CSV prodotti contengono dati personali: NON vanno committati
nel repository (vedi .gitignore).
"""
import argparse
import collections
import csv
import datetime
import os
import statistics
import struct


def read_dbf(path, fpt=None):
    """Ritorna la lista di record (dict campo->stringa) di un file DBF.
    Gestisce i campi memo (M) leggendo il file .fpt associato."""
    with open(path, "rb") as f:
        data = f.read()
    memo = None
    if fpt and os.path.exists(fpt):
        with open(fpt, "rb") as f:
            memo = f.read()
    blocksize = (struct.unpack(">H", memo[6:8])[0] or 1) if memo else 1

    numrec = struct.unpack("<I", data[4:8])[0]
    hdrlen = struct.unpack("<H", data[8:10])[0]
    reclen = struct.unpack("<H", data[10:12])[0]

    fields = []
    pos = 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b"\x00")[0].decode("latin1")
        ftype = chr(data[pos + 11])
        flen = data[pos + 16]
        fields.append((name, ftype, flen))
        pos += 32

    def get_memo(raw):
        blk = struct.unpack("<I", raw)[0]
        if blk <= 0 or not memo:
            return ""
        off = blk * blocksize
        if off + 8 > len(memo):
            return ""
        mlen = struct.unpack(">I", memo[off + 4:off + 8])[0]
        return (memo[off + 8:off + 8 + mlen]
                .decode("latin1", "replace")
                .replace("\r", " ").replace("\n", " ").strip())

    def conv(raw, ftype):
        if ftype == "M":
            return get_memo(raw)
        s = raw.decode("latin1").strip()
        if ftype == "D":
            return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if (len(s) == 8 and s.isdigit() and s != "00000000") else ""
        if ftype == "L":
            return {"T": "1", "Y": "1"}.get(s.upper(), "0")
        if ftype == "I":
            return str(struct.unpack("<i", raw)[0]) if len(raw) == 4 else s
        return s

    rows = []
    for r in range(numrec):
        rec = data[hdrlen + r * reclen: hdrlen + (r + 1) * reclen]
        if len(rec) < reclen:
            break
        if rec[0:1] == b"*":  # record cancellato
            continue
        off = 1
        d = {}
        for name, ftype, flen in fields:
            d[name] = conv(rec[off:off + flen], ftype)
            off += flen
        rows.append(d)
    return rows


def months_between(a, b):
    try:
        d1 = datetime.date.fromisoformat(a)
        d2 = datetime.date.fromisoformat(b)
        return max(0, round((d2 - d1).days / 30.44))
    except Exception:
        return None


def is_open_ended(d):
    # Il gestionale usa 3000-01-01 come "senza scadenza" (tipico dei carnet).
    return bool(d) and d >= "2900-01-01"


def is_generic(r):
    return r["COGNOME"].strip().upper() == "CLIENTE" and "GENERICO" in r["NOME"].strip().upper()


def norm_sesso(s):
    s = s.strip().upper()
    return s if s in ("M", "F") else ""


def main():
    ap = argparse.ArgumentParser(description="Converte i DBF legacy in CSV per GymIN")
    ap.add_argument("--in", dest="indir", default="./data", help="cartella con anagraf.dbf/.fpt e tessere.dbf")
    ap.add_argument("--out", dest="outdir", default="./data/out", help="cartella di output dei CSV")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    anag = read_dbf(os.path.join(args.indir, "anagraf.dbf"),
                    os.path.join(args.indir, "anagraf.fpt"))
    tess = read_dbf(os.path.join(args.indir, "tessere.dbf"))

    # ---- SOCI ---------------------------------------------------------------
    soci = []
    for r in anag:
        if is_generic(r):
            continue
        cod = r["COD_CLI"].strip()
        soci.append({
            "cod_cli": cod,
            "tessera": cod,
            "nome": r["NOME"].strip(),
            "cognome": r["COGNOME"].strip(),
            "email": r["EMAIL"].strip(),
            "telefono": r["CELLULARE"].strip() or r["TELEFONO"].strip(),
            "data_nascita": r["DATA_NASC"],
            "sesso": norm_sesso(r["SESSO"]),
            "codice_fiscale": r["CF"].strip().upper(),
            "indirizzo": r["INDIRIZZO"].strip(),
            "citta": r["CITTA"].strip(),
            "cap": r["CAP"].strip(),
            "provincia": r["PROVINCIA"].strip().upper(),
            "consenso_mail": "true" if r.get("L675_MSG", "0") == "1" else "false",
            "note": r["NOTE"].strip(),
        })
    soci_cols = ["cod_cli", "tessera", "nome", "cognome", "email", "telefono",
                 "data_nascita", "sesso", "codice_fiscale", "indirizzo", "citta",
                 "cap", "provincia", "consenso_mail", "note"]
    write_csv(os.path.join(args.outdir, "soci.csv"), soci_cols, soci)
    valid_cli = {s["cod_cli"] for s in soci}

    # ---- ABBONAMENTI (dalle tessere, escluso il record tecnico "Ufficio") ---
    abb = []
    for r in tess:
        serv = r["SERVIZIO"].strip()
        if not serv or serv == "Ufficio" or serv == "\\":
            continue
        cod = r["COD_CLI"].strip()
        if cod not in valid_cli:
            continue
        gi, gf = r["G_INIZIO"], r["G_FINE"]
        if not gi and not gf:
            continue
        abb.append({
            "cod_cli": cod,
            "piano_nome": serv,
            "tipo_serv": r["TIPO_SERV"].strip(),
            "data_inizio": gi,
            "data_scadenza": gf,
            "open_ended": "true" if is_open_ended(gf) else "false",
            "entrate_residue": "",
            "disabilitato": "true" if r["DISABLED"] == "1" else "false",
        })
    # marca l'abbonamento piu recente per socio (data_scadenza massima)
    latest = {}
    for i, a in enumerate(abb):
        k = a["cod_cli"]
        if k not in latest or (a["data_scadenza"] or "0000") > (abb[latest[k]]["data_scadenza"] or "0000"):
            latest[k] = i
    for i, a in enumerate(abb):
        a["is_latest"] = "1" if latest.get(a["cod_cli"]) == i else "0"
    abb_cols = ["cod_cli", "piano_nome", "tipo_serv", "data_inizio", "data_scadenza",
                "open_ended", "entrate_residue", "disabilitato", "is_latest"]
    write_csv(os.path.join(args.outdir, "abbonamenti.csv"), abb_cols, abb)

    # ---- PIANI (distinti dalle tessere) -------------------------------------
    byplan = collections.defaultdict(list)
    for a in abb:
        byplan[a["piano_nome"]].append(a)
    piani = []
    for nome, lst in sorted(byplan.items(), key=lambda kv: -len(kv[1])):
        carnet = "ingress" in nome.lower()
        durs = [m for a in lst if a["open_ended"] != "true"
                for m in [months_between(a["data_inizio"], a["data_scadenza"])]
                if m and m <= 36]
        dur = int(statistics.median(durs)) if durs else (6 if carnet else 1)
        piani.append({
            "nome": nome,
            "prezzo": "0",  # da compilare: i prezzi stanno nelle tabelle tariffe/listini
            "durata_mesi": max(1, min(36, dur)),
            "entrate": "10" if carnet else "0",  # placeholder per i carnet: verificare il numero reale
            "descrizione": f"Importato dal gestionale (tipo: {lst[0]['tipo_serv']}) - prezzo/entrate da verificare",
            "attivo": "true",
        })
    piani_cols = ["nome", "prezzo", "durata_mesi", "entrate", "descrizione", "attivo"]
    write_csv(os.path.join(args.outdir, "piani.csv"), piani_cols, piani)

    print(f"OK · soci={len(soci)} · piani={len(piani)} · abbonamenti={len(abb)}"
          f" · soci con abbonamento={len(latest)}")
    print(f"CSV in: {args.outdir}")


def write_csv(path, cols, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
