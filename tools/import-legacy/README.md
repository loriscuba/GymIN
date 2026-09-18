# Import dati dal vecchio gestionale → GymIN

Strumenti per recuperare **anagrafiche** e **abbonamenti** dal vecchio gestionale
(database in formato **DBF/FoxPro**) e importarli nel database Supabase di GymIN.

> ⚠️ **Privacy/GDPR.** I file `.dbf` e i CSV generati contengono dati personali
> reali dei soci. **Non vanno mai committati** nel repository (la demo GymIN è
> pubblica): il `.gitignore` di questa cartella li esclude. Qui restano solo gli
> script.

## Cosa produce

Dal database legacy (`anagraf.dbf` + memo `anagraf.fpt`, `tessere.dbf`) si ottengono
tre CSV mappati sullo schema GymIN:

| CSV | Tabella GymIN | Note |
|-----|---------------|------|
| `soci.csv` | `soci` | anagrafica completa; `cod_cli` = codice cliente legacy |
| `piani.csv` | `piani` | dedotti dai servizi delle tessere; **prezzo/entrate da verificare** |
| `abbonamenti.csv` | `abbonamenti` | dalle tessere; collegati ai soci via `cod_cli` |

Mappatura anagrafica: `NOME→nome`, `COGNOME→cognome`, `EMAIL→email`,
`CELLULARE`/`TELEFONO→telefono`, `DATA_NASC→data_nascita`, `SESSO→sesso`,
`CF→codice_fiscale`, `INDIRIZZO→indirizzo`, `CITTA→citta`, `CAP→cap`,
`PROVINCIA→provincia`, `L675_MSG→consenso_mail`, `NOTE→note` (dal memo),
`COD_CLI→cod_cli`/`tessera`.

Abbonamenti: dalle tessere si escludono i record tecnici `SERVIZIO = "Ufficio"`.
Il nome piano viene da `SERVIZIO` (`Open`, `1/2/3 V settimana`, `N ingressi`, …).
La data-sentinella `3000-01-01` significa **senza scadenza** (carnet): l'importatore
la sostituisce con `data_inizio + durata del piano`.

## Prerequisiti

1. Estrai dal backup del gestionale questi file in `./data/`:
   - `anagraf.dbf`, `anagraf.fpt`, `tessere.dbf`
2. Python 3 (nessuna dipendenza esterna per la conversione).
3. Node 18+ e le dipendenze per l'import:
   ```bash
   npm install
   ```
4. Un file `.env` con le chiavi Supabase (come per il mailer — la
   `service_role` bypassa la RLS, quindi **tienila segreta**):
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```

## Uso

Applica prima le migration del DB (aggiungono `soci.provincia` e `soci.cod_cli`):

```bash
# dalla root del repo, con la Supabase CLI:
supabase db push
```

Poi:

```bash
cd tools/import-legacy
npm install

# 1) DBF -> CSV
npm run convert            # legge ./data, scrive ./data/out

# 2) anteprima senza scrivere nulla
npm run import:dry

# 3) import (un abbonamento "corrente" per socio, così l'app resta pulita)
npm run import

# varianti:
npm run import:all         # importa TUTTO lo storico abbonamenti
npm run import:replace     # rimuove gli abbonamenti esistenti dei soci e reimporta
```

## Idempotenza

- **piani**: inseriti solo se il `nome` non esiste già.
- **soci**: `upsert` su `cod_cli` — rilanciare l'import aggiorna, non duplica.
- **abbonamenti**: senza chiave naturale. Di default si importa **un solo
  abbonamento corrente per socio** (`is_latest`). Con `--replace` gli abbonamenti
  esistenti dei soci importati vengono prima rimossi (attenzione: `on delete
  cascade` elimina anche gli eventuali pagamenti collegati).

## Punti da verificare dopo l'import

- **Prezzi dei piani** (`piani.prezzo = 0`): i listini stanno in altre tabelle
  del gestionale (`tariffe.dbf`, `listini.dbf`). Vanno inseriti a mano o con un
  secondo giro di import.
- **Entrate dei carnet** (`N ingressi`): il numero reale di ingressi non è nelle
  tessere; è impostato a un valore placeholder (10) da correggere.
- **Soci senza abbonamento** (~670): nel gestionale avevano solo il record
  tecnico "Ufficio". Con lo schema attuale dell'app compaiono solo i soci che
  hanno almeno un abbonamento (la home elenca gli abbonamenti). Se servono anche
  loro nell'elenco, valutare una vista/patch lato app.

## Note tecniche

`dbf_to_csv.py` include un parser DBF/FPT minimale (nessuna dipendenza): legge
l'header, i descrittori di campo, converte date `AAAAMMGG→AAAA-MM-GG`, i booleani
e i campi memo (blocchi del file `.fpt`).
