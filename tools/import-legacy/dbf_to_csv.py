#!/usr/bin/env python3
"""GymIN · convertitore dati legacy (DBF/FoxPro) -> CSV puliti per l'import.

Legge i dati del vecchio gestionale (file .dbf con memo .fpt) e produce i CSV
mappati sullo schema GymIN:
  - soci.csv        (tabella soci; colonna `senza_abbonamento` = socio in
                     anagrafica ma senza alcun abbonamento reale)
  - piani.csv       (tabella piani, dedotti dalle tessere)
  - abbonamenti.csv (tabella abbonamenti, dalle tessere; collegati via cod_cli)
  - ricariche.csv   (solo se presente cnt_bank.dbf: ricariche "scatti"/ingressi
                     per socio, con importo — è la base delle entrate dei carnet)

File di input attesi in --in:
  anagraf.dbf, anagraf.fpt, tessere.dbf   (obbligatori)
  cnt_bank.dbf                            (opzionale, per prezzi/entrate carnet)

IMPORTANTE sul gestionale legacy: è un sistema di controllo accessi PREPAGATO
"a scatti" (ingressi), non ad abbonamenti a prezzo fisso. Il listino prezzi
(listini.dbf) è vuoto: NON esistono prezzi di abbonamento da recuperare. I soci
ricaricano ingressi ("Ricarica N scatti") pagando importi variabili, registrati
in cnt_bank.dbf. Quindi:
  - piani.prezzo resta 0 (da compilare a mano nel gestionale nuovo);
  - le "entrate" dei carnet (N ingressi) vengono stimate dall'ultima ricarica
    del socio (campo entrate_residue negli abbonamenti carnet).

Nessuna dipendenza esterna: parser DBF/FPT minimale incluso.

Uso:
  python3 dbf_to_csv.py --in ./data --out ./data/out

I file di input e i CSV prodotti contengono dati personali: NON vanno committati
nel repository (vedi .gitignore).
"""
import argparse
import collections
import csv
import datetime
import os
import re
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


# ---------------------------------------------------------------------------
# Ricariche (cnt_bank.dbf): "Ricarica N scatti" per socio -> entrate carnet
# ---------------------------------------------------------------------------
RX_SCATTI = re.compile(r"Ricarica\s+(\d+)\s+scatt", re.I)
RX_CLI = re.compile(r"^[A-Za-z]?(\d+)\s*-")


def read_ricariche(path):
    """Aggrega le ricariche di ingressi per socio dal libro movimenti.
    Ritorna dict cod_cli -> {scatti_totali, importo_totale, ultima_ricarica,
    ultimi_scatti} e la lista dei movimenti grezzi."""
    rows = read_dbf(path)
    per = {}
    movimenti = []
    for r in rows:
        caus = r.get("CAUSALE", "")
        if "ricaric" not in caus.lower():
            continue
        mc = RX_CLI.match(r.get("BANCA", ""))
        cod = mc.group(1) if mc else None
        if not cod:
            continue
        ms = RX_SCATTI.search(caus)
        scatti = int(ms.group(1)) if ms else 0
        try:
            importo = float(r.get("AVERE", "0") or 0)
        except ValueError:
            importo = 0.0
        data_mov = r.get("DATA_MOV", "")
        movimenti.append({"cod_cli": cod, "data": data_mov, "scatti": scatti,
                          "importo": f"{importo:.2f}", "causale": caus})
        p = per.setdefault(cod, {"scatti_totali": 0, "importo_totale": 0.0,
                                 "ultima_ricarica": "", "ultimi_scatti": 0})
        p["scatti_totali"] += scatti
        p["importo_totale"] += importo
        if data_mov and data_mov >= p["ultima_ricarica"]:
            p["ultima_ricarica"] = data_mov
            if scatti:
                p["ultimi_scatti"] = scatti
    return per, movimenti


def write_csv(path, cols, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser(description="Converte i DBF legacy in CSV per GymIN")
    ap.add_argument("--in", dest="indir", default="./data", help="cartella con i .dbf/.fpt")
    ap.add_argument("--out", dest="outdir", default="./data/out", help="cartella di output dei CSV")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    anag = read_dbf(os.path.join(args.indir, "anagraf.dbf"),
                    os.path.join(args.indir, "anagraf.fpt"))
    tess = read_dbf(os.path.join(args.indir, "tessere.dbf"))

    # ricariche (opzionale)
    cnt_path = os.path.join(args.indir, "cnt_bank.dbf")
    ricariche_per_cli, movimenti = ({}, [])
    if os.path.exists(cnt_path):
        ricariche_per_cli, movimenti = read_ricariche(cnt_path)

    # ---- ABBONAMENTI (dalle tessere, escluso il record tecnico "Ufficio") ---
    # (calcolati prima dei soci per sapere chi è "senza abbonamento")
    valid_cli = {r["COD_CLI"].strip() for r in anag if not is_generic(r)}
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
        # entrate carnet: stima dall'ultima ricarica del socio (best-effort)
        if a["is_latest"] == "1" and "ingress" in a["piano_nome"].lower():
            ric = ricariche_per_cli.get(a["cod_cli"])
            if ric and ric["ultimi_scatti"]:
                a["entrate_residue"] = str(ric["ultimi_scatti"])
    soci_con_abb = set(latest)

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
            "senza_abbonamento": "false" if cod in soci_con_abb else "true",
        })
    soci_cols = ["cod_cli", "tessera", "nome", "cognome", "email", "telefono",
                 "data_nascita", "sesso", "codice_fiscale", "indirizzo", "citta",
                 "cap", "provincia", "consenso_mail", "note", "senza_abbonamento"]
    write_csv(os.path.join(args.outdir, "soci.csv"), soci_cols, soci)

    abb_cols = ["cod_cli", "piano_nome", "tipo_serv", "data_inizio", "data_scadenza",
                "open_ended", "entrate_residue", "disabilitato", "is_latest"]
    write_csv(os.path.join(args.outdir, "abbonamenti.csv"), abb_cols, abb)

    # ---- PIANI (distinti dalle tessere) -------------------------------------
    byplan = collections.defaultdict(list)
    for a in abb:
        byplan[a["piano_nome"]].append(a)
    # taglia carnet nominale = mediana degli "ultimi scatti" ricaricati
    ultimi = [v["ultimi_scatti"] for v in ricariche_per_cli.values() if v["ultimi_scatti"]]
    pack_carnet = int(statistics.median(ultimi)) if ultimi else 10
    piani = []
    for nome, lst in sorted(byplan.items(), key=lambda kv: -len(kv[1])):
        carnet = "ingress" in nome.lower()
        durs = [m for a in lst if a["open_ended"] != "true"
                for m in [months_between(a["data_inizio"], a["data_scadenza"])]
                if m and m <= 36]
        dur = int(statistics.median(durs)) if durs else (6 if carnet else 1)
        piani.append({
            "nome": nome,
            "prezzo": "0",  # NON recuperabile: il gestionale legacy è prepagato a scatti
            "durata_mesi": max(1, min(36, dur)),
            "entrate": str(pack_carnet) if carnet else "0",
            "descrizione": f"Importato dal gestionale (tipo: {lst[0]['tipo_serv']}) - "
                           + ("carnet a ingressi; prezzo/taglia da verificare" if carnet
                              else "prezzo da compilare (sistema legacy a scatti)"),
            "attivo": "true",
        })
    piani_cols = ["nome", "prezzo", "durata_mesi", "entrate", "descrizione", "attivo"]
    write_csv(os.path.join(args.outdir, "piani.csv"), piani_cols, piani)

    # ---- RICARICHE (per socio) ---------------------------------------------
    if ricariche_per_cli:
        ric_rows = [{
            "cod_cli": cod,
            "scatti_totali": v["scatti_totali"],
            "importo_totale": f"{v['importo_totale']:.2f}",
            "ultima_ricarica": (f"{v['ultima_ricarica'][0:4]}-{v['ultima_ricarica'][4:6]}-{v['ultima_ricarica'][6:8]}"
                                if len(v["ultima_ricarica"]) == 8 else ""),
            "ultimi_scatti": v["ultimi_scatti"],
        } for cod, v in sorted(ricariche_per_cli.items(), key=lambda kv: -kv[1]["scatti_totali"])]
        write_csv(os.path.join(args.outdir, "ricariche.csv"),
                  ["cod_cli", "scatti_totali", "importo_totale", "ultima_ricarica", "ultimi_scatti"],
                  ric_rows)

    senza = sum(1 for s in soci if s["senza_abbonamento"] == "true")
    print(f"OK · soci={len(soci)} (senza abbonamento={senza}) · piani={len(piani)}"
          f" · abbonamenti={len(abb)} · ricariche_soci={len(ricariche_per_cli)}")
    print(f"CSV in: {args.outdir}")


if __name__ == "__main__":
    main()
