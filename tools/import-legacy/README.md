# Import dati dal vecchio gestionale → GymIN

Strumenti per recuperare **anagrafiche** e **abbonamenti** dal vecchio gestionale
(database in formato **DBF/FoxPro**) e importarli nel database Supabase di GymIN.

> ⚠️ **Privacy/GDPR.** I file `.dbf` e i CSV generati contengono dati personali
> reali dei soci. **Non vanno mai committati** nel repository (la demo GymIN è
> pubblica): il `.gitignore` di questa cartella li esclude. Qui restano solo gli
> script.

## Cosa produce

Dal database legacy (`anagraf.dbf` + memo `anagraf.fpt`, `tessere.dbf`,
e opzionalmente `cnt_bank.dbf`) si ottengono i CSV mappati sullo schema GymIN:

| CSV | Tabella GymIN | Note |
|-----|---------------|------|
| `soci.csv` | `soci` | anagrafica completa; `cod_cli` = codice cliente legacy; `senza_abbonamento` = socio senza alcun abbonamento |
| `piani.csv` | `piani` | dedotti dai servizi delle tessere; **prezzo 0** (vedi sotto) |
| `abbonamenti.csv` | `abbonamenti` | dalle tessere; collegati ai soci via `cod_cli`; `entrate_residue` dei carnet dalle ricariche |
| `ricariche.csv` | (riferimento) | solo con `cnt_bank.dbf`: scatti ricaricati e importi per socio; con `accessi.dbf` anche `consumati` e `residuo` esatto |

### Prezzi ed entrate — cosa è realmente recuperabile

Il gestionale legacy è un **sistema di controllo accessi prepagato "a scatti"**
(ingressi), non ad abbonamenti a prezzo fisso:

- **Prezzi degli abbonamenti: non esistono.** Il listino (`listini.dbf`) è vuoto
  e le tabelle tariffe non hanno un campo prezzo. I soci pagano ricaricando
  ingressi (importi variabili). Perciò `piani.prezzo` resta `0`, da compilare nel
  gestionale nuovo.
- **Entrate dei carnet ("N ingressi"): contatore della tessera.** L'`entrate_residue`
  è il campo `SCATTISING` di `tessere.dbf`, cioè il contatore che il gestionale
  stesso usa per far entrare (mai < 0). Solo se il campo manca si ricalcola:

  ```
  residuo = scatti ricaricati (cnt_bank.dbf) − accessi "Attivazione servizio" (accessi.dbf)
  ```

  Attenzione: in `accessi.dbf` ogni passaggio della tessera è registrato, anche
  quelli rifiutati ("Tessera scaduta", "Disabilitata", "Disponibilità esaurita",
  "Tessera ignorata…"). Solo "Attivazione servizio" è un ingresso che consuma uno scatto.

### Soci senza abbonamento

I soci presenti in anagrafica ma senza alcun abbonamento reale (nel legacy
avevano solo il record tecnico "Ufficio") vengono **importati comunque** e
marcati con `senza_abbonamento = true`. L'app li mostra in anagrafica con il
badge **"Senza abbonamento"** e un filtro dedicato.

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
   - `anagraf.dbf`, `anagraf.fpt`, `tessere.dbf` (obbligatori)
   - `cnt_bank.dbf` (opzionale, per le ricariche/entrate dei carnet)
   - `accessi.dbf` (opzionale, usato solo se `tessere.dbf` non ha il campo `SCATTISING`)
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

## Reimport degli abbonamenti dall'app (cruscotto admin)

Per riallineare **solo gli abbonamenti** senza toccare le anagrafiche:

1. In GymIN (utente admin) → menu **Import abbonamenti** → *Scegli file (DBF o CSV)*
2. Da Esplora risorse, nella cartella del vecchio gestionale, seleziona con Ctrl+clic
   `tessere.dbf` (obbligatorio) e `anagraf.dbf` (consigliato). `cnt_bank.dbf` e `accessi.dbf`
   non servono più: le entrate dei carnet vengono dal contatore della tessera.
   La conversione avviene nel browser (`web/js/legacydbf.js`, stesse regole di `dbf_to_csv.py`):
   niente Python/npm e i file non vengono caricati da nessuna parte. In alternativa si può
   scegliere l'`abbonamenti.csv` prodotto da `npm run convert`.
3. Gli abbonamenti vengono confrontati col DB (sola lettura) e ogni riga è classificata:
   **Nuovo**, **Diverso** (scadenza/entrate/stato cambiati, mostra prima → dopo),
   **Già presente**, **Socio mancante**, **Piano mancante**.
4. Si importa riga per riga (*Importa* / *Aggiorna*) o in blocco (*Importa selezionati*), sempre con conferma.

Regole: scrive solo su `abbonamenti` (mai `soci`, `piani`, `pagamenti`); stesso socio + piano +
`data_inizio` = stesso abbonamento, quindi rilanciarlo non crea doppioni; gli abbonamenti
`archiviato` non cambiano stato. Ogni scrittura finisce nel Log attività.

## Import automatico ogni mattina (`auto-import.mjs`)

Fa da solo quello che il cruscotto fa a mano: legge `tessere.dbf` + `anagraf.dbf` dalla cartella
condivisa, confronta col DB e importa **tutte** le righe *Nuovo* e *Diverso* (stesse regole del
cruscotto, codice condiviso in `web/js/importlogic.js`). Solo abbonamento corrente per socio; le righe
*Socio mancante* / *Piano mancante* restano da gestire a mano nel cruscotto.

Sul PC Win 11 (serve Node 18+ e una copia del repo):

1. `cd tools\import-legacy` e `npm install`
2. `.env` in questa cartella:
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   GYMIN_IMPORT_DIR=\\172.16.0.155\Condivisa
   ```
   Meglio il percorso di rete che `Z:`: le attività pianificate non vedono le unità collegate.
   Le credenziali della condivisione vanno salvate una volta: `cmdkey /add:172.16.0.155 /user:172.16.0.155\utente /pass:...`
3. Prova: `npm run auto:dry` (anteprima, nessuna scrittura), poi `npm run auto`.
4. Pianifica `auto-import.bat` dopo la copia delle 9 (es. 9:15):
   ```
   schtasks /create /tn "GymIN import" /tr "C:\percorso\GymIN\tools\import-legacy\auto-import.bat" /sc daily /st 09:15
   ```
   L'esito di ogni giro è in `auto-import.log` accanto allo script.

## Idempotenza

- **piani**: inseriti solo se il `nome` non esiste già.
- **soci**: `upsert` su `cod_cli` — rilanciare l'import aggiorna, non duplica.
- **abbonamenti**: senza chiave naturale. Di default si importa **un solo
  abbonamento corrente per socio** (`is_latest`). Con `--replace` gli abbonamenti
  esistenti dei soci importati vengono prima rimossi (attenzione: `on delete
  cascade` elimina anche gli eventuali pagamenti collegati).

## Punti da verificare dopo l'import

- **Prezzi dei piani** (`piani.prezzo = 0`): non esistono nel gestionale legacy
  (sistema prepagato a scatti, listino vuoto). Vanno inseriti a mano nel nuovo
  gestionale in base al listino attuale della palestra.
- **Entrate dei carnet** (`N ingressi`): presi dal contatore della tessera
  (`tessere.SCATTISING`), come li vede il vecchio gestionale.
- **Soci senza abbonamento**: importati e marcati (`senza_abbonamento`); l'app li
  mostra con badge e filtro dedicati (modifiche in `web/js/data.js`,
  `web/js/app.js`, `web/index.html`).

## Note tecniche

`dbf_to_csv.py` include un parser DBF/FPT minimale (nessuna dipendenza): legge
l'header, i descrittori di campo, converte date `AAAAMMGG→AAAA-MM-GG`, i booleani
e i campi memo (blocchi del file `.fpt`).

## Import delle vecchie tessere RFID (`tessere_rfid.py`)

Il vecchio gestionale salva il codice tessera (`COD_TESS`) in 13 cifre: 3 di prefisso + 10 cifre
con i bit di **ogni byte in ordine rovesciato** rispetto a quanto "digita" il nuovo lettore USB EM4100
(es. `0540006035015` → `0003827938`; verificato su tessere reali). Lo script converte i codici e genera
un SQL idempotente che popola `tessere` collegando i soci via `cod_cli`:

```bash
python3 tessere_rfid.py --in ./data/tessere.dbf --out ./data/out/tessere_rfid.sql   # --schema test per il test
python3 -m unittest test_tessere_rfid
```

Le tessere già attive non vengono toccate; i codici presenti su più soci sono esclusi ed elencati a video
(da associare a mano da GymIN → Tessere). Il file SQL contiene codici di accesso reali: **non committarlo**.
