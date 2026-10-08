#!/usr/bin/env python3
"""GymIN · import delle vecchie tessere RFID (tessere.dbf) nella tabella `tessere`.

Il vecchio gestionale salva il codice tessera (COD_TESS) in 13 cifre:
3 cifre di prefisso + 10 cifre con i bit di OGNI byte in ordine rovesciato
rispetto a quello che "digita" il nuovo lettore USB EM4100.
  es. 054 0006035015 -> 0x005C1647 -> bit rovesciati per byte -> 0x003A68E2 -> 0003827938
Verificato su due tessere reali (Cubaiu 2840, Murialdo 2429).

Produce un file SQL idempotente da eseguire nel SQL Editor di Supabase:
  - collega i codici ai soci via soci.cod_cli = COD_CLI;
  - salta i codici già attivi in `tessere` (associazioni fatte a mano incluse);
  - esclude i codici ambigui (stessa tessera su più soci) e li elenca a video.

Uso:
  python3 tessere_rfid.py --in ./data/tessere.dbf --out ./data/out/tessere_rfid.sql [--schema public]

Il file SQL contiene codici di accesso reali: NON va committato.
"""
import argparse
import collections
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbf_to_csv import read_dbf  # noqa: E402


def converti_codice(cod_tess):
    """COD_TESS legacy (13 cifre) -> codice del nuovo lettore (10 cifre), o None."""
    s = (cod_tess or "").strip()
    if not re.fullmatch(r"\d{13}", s):
        return None
    n = int(s[3:])
    if n >= 1 << 32:
        return None
    b = bytes(int(format(x, "08b")[::-1], 2) for x in n.to_bytes(4, "big"))
    return "%010d" % int.from_bytes(b, "big")


def associazioni(rows):
    """-> (lista ordinata (codice, cod_cli), dict codici ambigui -> set cod_cli, scartati)."""
    per_codice = collections.defaultdict(set)
    scartati = 0
    for r in rows:
        cod = converti_codice(r.get("COD_TESS"))
        cli = (r.get("COD_CLI") or "").strip()
        if not cod or not cli or cli == "0":
            scartati += 1
            continue
        per_codice[cod].add(cli)
    ok = sorted((c, next(iter(v))) for c, v in per_codice.items() if len(v) == 1)
    ambigui = {c: v for c, v in per_codice.items() if len(v) > 1}
    return ok, ambigui, scartati


def genera_sql(coppie, schema="public"):
    if not re.fullmatch(r"[a-z_]+", schema):
        raise ValueError("schema non valido")
    valori = ",\n".join(f"  ('{c}','{k}')" for c, k in coppie)
    return f"""-- Import vecchie tessere RFID dal gestionale legacy (generato da tools/import-legacy/tessere_rfid.py)
-- Idempotente: non tocca le tessere già attive.
begin;
with legacy(codice, cod_cli) as (values
{valori}
)
insert into {schema}.tessere (codice, socio_id)
select distinct on (l.codice) l.codice, s.id
from legacy l
join {schema}.soci s on s.cod_cli = l.cod_cli
where not exists (select 1 from {schema}.tessere t where t.codice = l.codice and t.attiva)
order by l.codice, s.id;
commit;
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", required=True, help="percorso di tessere.dbf")
    ap.add_argument("--out", required=True, help="file .sql da scrivere")
    ap.add_argument("--schema", default="public")
    a = ap.parse_args()
    coppie, ambigui, scartati = associazioni(read_dbf(a.inp))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(genera_sql(coppie, a.schema))
    print(f"Tessere da importare: {len(coppie)} (soci: {len({k for _, k in coppie})}); record scartati: {scartati}")
    for c, v in sorted(ambigui.items()):
        print(f"ESCLUSA, su più soci: {c} -> cod_cli {', '.join(sorted(v))} (associarla a mano)")
    print(f"SQL scritto in {a.out}")


if __name__ == "__main__":
    main()
