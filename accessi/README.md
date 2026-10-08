# GymIN · Accessi

Terminale di **controllo accessi** per l'ingresso della palestra, più una pagina di **gestione tessere** per lo staff.
È un sotto-progetto di GymIN: usa lo **stesso database Supabase**, lo stesso login staff e lo stesso stile grafico.

| Pagina | Per chi | Cosa fa |
|---|---|---|
| `/accessi/ingresso/` | PC dell'ingresso (Chrome in modalità kiosk) | Passi la tessera RFID e lo schermo diventa verde o rosso, con suono, nome del socio e abbonamento |
| `/accessi/gestione/` | Staff (login di GymIN), anche dentro GymIN alla voce **Tessere** | Associa le tessere, annulla un ingresso, consulta lo storico, gestisce gli accessi offline da verificare e i terminali |

> **Stato:** completo. Fase 1 (online), fase 2 (offline: PWA, cache locale, coda eventi, sincronizzazione, conflitti) e fase 3 (script kiosk per Windows e guida di installazione).

## Struttura

```
accessi/
├─ app/                    # web app statica (HTML/CSS/JS moduli, senza framework, come GymIN)
│  ├─ ingresso/            # schermata kiosk
│  ├─ gestione/            # pagina staff
│  ├─ js/esito.js          # REGOLE DEGLI ESITI: funzione pura e testata
│  ├─ js/dataLayer.js      # UNICO accesso ai dati: sorgente remota, locale e demo + fallback online/offline
│  ├─ js/archivio.js       # IndexedDB: cache minima + coda eventi offline
│  ├─ js/sync.js           # sincronizzazione: coda a lotti, ricarica cache, stato, retry con backoff
│  ├─ js/lettore.js        # listener globale per il lettore RFID in emulazione tastiera
│  ├─ js/suoni.js          # suoni con la Web Audio API
│  ├─ js/demo.js           # dati demo in memoria per la simulazione
│  ├─ sw.js                # service worker (PWA): la pagina funziona anche senza internet
│  └─ manifest.webmanifest
├─ kiosk/                  # PC del cliente: script .bat di avvio kiosk + LEGGIMI.txt (installazione)
├─ sql/seed-dev.sql        # dati demo per il DB di SVILUPPO (mai in produzione)
├─ scripts/                # dev-server, build, test-db, seed-dev (nessuna dipendenza esterna)
└─ test/                   # test unitari (node:test) e test SQL su Postgres vero (test/db)
supabase/migrations/20261006120000_accessi_terminale.sql   # fase 1 (solo aggiunte)
supabase/migrations/20261007120000_accessi_offline.sql     # fase 2 (solo aggiunte)
```

## Database: cosa aggiunge la migrazione

`supabase/migrations/20261006120000_accessi_terminale.sql` fa **solo aggiunte**: nessuna tabella o colonna esistente viene modificata.

- **`tessere`**: codice letto dal lettore → socio. Il codice è attivo su un solo socio alla volta e le tessere disattivate restano nello storico. Il campo `soci.tessera` di GymIN (il numero stampato) resta invariato.
- **`terminali`**: i PC autorizzati. Il token è salvato solo come hash SHA-256.
- **`accessi_log`**: ogni lettura (ok, negato, doppia lettura, annullo), con tessera, socio, abbonamento, motivo, residuo prima e dopo, `ts_terminale`, `ts_server`, `offline` e `da_verificare`. `evento_id` è univoco: è la chiave di **idempotenza**.
- **Specchio in `accessi`**: ogni ingresso valido scrive anche una riga in `accessi` (`ingresso = 'Terminale'`), così la dashboard di GymIN lo conta. Annullando l'ingresso la riga viene tolta.

**Funzioni** (`security definer`):

| Funzione | Chi | Cosa |
|---|---|---|
| `terminale_accesso(token, codice, evento_id, ts, doppia)` | terminale | Valuta, scala e registra in **un'unica transazione** e restituisce l'esito completo. Blocca le righe degli abbonamenti del socio (`FOR UPDATE`), quindi le letture concorrenti vengono serializzate e il residuo non scende mai sotto zero. Lo stesso `evento_id` restituisce l'esito già registrato, senza scalare due volte. |
| `terminale_ping(token)` | terminale | Verifica il token e restituisce l'ora del server |
| `staff_assegna_tessera / staff_disattiva_tessera` | staff | Associazione con conferma se il codice è di un altro socio, sostituzione e smarrimento |
| `staff_annulla_ingresso` | staff | Ripristina l'ingresso scalato e lascia una riga `annullo` nel log |
| `staff_tessere_non_associate` | staff | Codici letti al terminale che non appartengono a nessuno |
| `staff_segna_verificato` | staff | Chiude un accesso offline da verificare |
| `staff_crea_terminale / staff_revoca_terminale` | staff | Ruolo "terminale ingresso" |

### Applicare la migrazione

- **Supabase online** (come il resto di GymIN): SQL Editor → incolla il file → Run.
- **Schema di test di GymIN**: `node scripts/test-schema.mjs 20261006120000` dalla radice del repo, poi incolla l'output nell'SQL Editor.
- **Supabase locale**: `supabase db reset` (applica tutte le migrazioni).

### Fase 2 (offline): `20261007120000_accessi_offline.sql`

Aggiunge solo funzioni, più due colonne alla tabella `terminali` creata in fase 1 (`stato`, `sync_richiesta_il`). Le tabelle di GymIN non vengono toccate.

| Funzione | Chi | Cosa |
|---|---|---|
| `terminale_snapshot(token, versione)` | terminale | Dati **minimi** per la cache: tessere attive, soci con solo id, nome e cognome, abbonamenti non archiviati validi, futuri o scaduti da al massimo 60 giorni. Niente telefono, email, note o prezzi. Se la versione non è cambiata risponde solo `{invariato: true}` |
| `terminale_sync(token, eventi)` | terminale | Applica gli eventi offline **in ordine cronologico**, ognuno con `accessi_esegui`: stesse regole, stessa atomicità e idempotenza su `evento_id`. Usa il timestamp del terminale e la marcatura `offline`; il timestamp di ricezione resta in `ts_server`. Un evento non valido non blocca gli altri |
| `terminale_stato(token, stato)` | terminale | Il terminale comunica coda, età della cache e sfasamento dell'orologio, e riceve l'eventuale "Sincronizza ora" |
| `staff_richiedi_sync(id)` | staff | Pulsante "Sincronizza ora" in /gestione |

## Modalità offline

Principio: **online-first con fallback locale**. Il server è la fonte di verità e un socio non viene mai bloccato solo perché manca internet.

- **Lettura online**: `terminale_accesso` con un `evento_id` (UUID) generato dal terminale. Se il server non risponde entro ~2 s (`TIMEOUT_ONLINE_MS`), il terminale decide in **locale con lo stesso `evento_id`**. Se il server aveva in realtà elaborato la richiesta, alla sincronizzazione l'evento risulta duplicato e non si scala due volte. Dopo un errore di rete le letture vanno subito in locale per 30 s, finché la sincronizzazione non ritrova il server.
- **Lettura offline**: stessa funzione pura (`esito.js`) sui dati della cache IndexedDB. Se l'esito è verde e l'abbonamento è a ingressi, scala il residuo locale. L'evento finisce in una **coda persistente** con ID evento, codice, timestamp locale, esito deciso, abbonamento usato e residuo prima e dopo.
- **Schermo**: verde, rosso e suoni restano identici. Nella schermata di attesa compare la banda **"OFFLINE – n accessi da sincronizzare"**; sull'esito, un piccolo badge.
- **Cache troppo vecchia** (oltre `CACHE_MAX_ORE`, di default 72): il terminale continua a funzionare, mostra l'avviso giallo fisso **"Dati non aggiornati da X ore"** e lo segnala nel log (colonna `nota` degli eventi).
- **Cache vuota e offline**: schermata dedicata **"Terminale non ancora sincronizzato"**.
- **Sincronizzazione**:
  - alla prima apertura scarica tutto;
  - poi ogni 60 s se online (`SYNC_INTERVALLO_MS`), subito dopo la riconnessione e su "Sincronizza ora";
  - la coda parte in ordine cronologico, a lotti da 50, e un evento esce dalla coda **solo** quando il server ne conferma la registrazione;
  - poi la cache viene ricaricata;
  - in caso di errore riprova con backoff (5 s, 10 s, 20 s… fino a 5 min).
- **Conflitti**: l'ingresso offline è già avvenuto e non si annulla. Se sul server l'abbonamento nel frattempo non è più valido, o gli ingressi sono finiti, l'accesso viene registrato con **`da_verificare`** e senza scalare: il residuo non va mai sotto zero. Compare in **/gestione → Offline da verificare**. Un socio respinto offline resta respinto.
- **Orologio**: si usa quello del PC. Ogni risposta porta l'ora del server; se la differenza supera 3 minuti compare un avviso nella barra in basso e lo stato arriva in /gestione.
- **Storage**: il terminale chiede lo storage persistente (`navigator.storage.persist()`). Token, cache e coda sono separati per schema, perché produzione e test stanno sullo stesso dominio.
- **PWA**: il service worker mette in cache tutta l'app (versionata a ogni deploy) e la pagina si apre anche dopo il riavvio del PC senza rete. **La prima apertura deve avvenire online.** Le chiamate al database non passano mai dalla cache. Quando esce una nuova versione, la pagina si ricarica da sola appena il terminale è in attesa.
- **/gestione → Terminali**: stato di ogni terminale (online o non raggiungibile, ultima sincronizzazione, accessi in coda, età dei dati locali, orologio) e pulsante **"Sincronizza ora"**. Le funzioni di /gestione richiedono la connessione: offline mostrano "disponibile solo online".
- **Più terminali**: ognuno ha il proprio token, la propria cache e la propria coda. Il server serializza gli accessi sullo stesso socio.

### Procedura di test offline

1. Apri `/accessi/ingresso/` **online**, configura il token e attendi la prima sincronizzazione: in basso compare "Online".
2. **Stacca la rete** (cavo o Wi-Fi). Il primo errore viene rilevato entro 2 s, oppure subito con l'evento `offline` del browser. Compare la banda "OFFLINE – 0 accessi da sincronizzare".
3. Passa alcune tessere:
   - un carnet scala il residuo e mostra il verde;
   - un abbonamento scaduto mostra il rosso;
   - la banda conta gli accessi in coda.
4. **Riavvia il PC o chiudi Chrome**, sempre senza rete: la pagina si riapre e la coda è ancora lì.
5. **Riattacca la rete**. Entro pochi secondi la coda si svuota e la barra torna "Online".
6. In **/gestione → Storico accessi** (filtro "Solo offline") trovi gli accessi con il loro orario reale. Se nel frattempo un abbonamento è scaduto, l'accesso è in **Offline da verificare**.

Senza staccare la rete: `?sim=1` (oppure `?demo=1`, senza database) → pulsante **SIM** → **Simula offline**.

## Ruolo "terminale ingresso" (sicurezza)

Il terminale **non contiene chiavi con poteri di amministratore**. Usa:

1. la **chiave anon** pubblica, la stessa già pubblicata dal sito GymIN. Il ruolo `anon` non ha policy RLS su nessuna tabella, quindi non legge soci, abbonamenti né log;
2. un **token del terminale**, che autorizza solo `terminale_accesso` e `terminale_ping`. È revocabile in ogni momento.

Come configurarlo:

1. Apri **Gestione accessi → Terminali → Nuovo terminale** (es. "Ingresso principale") e premi **Crea**.
2. Il token viene mostrato **una sola volta**: nel database resta solo il suo hash.
3. Sul PC dell'ingresso apri `/accessi/ingresso/` e incolla il token, oppure apri una volta `/accessi/ingresso/?token=…` (il token viene salvato nel browser e tolto dall'indirizzo).
4. Se il PC viene perso o sostituito: **Revoca**. Il terminale torna subito alla schermata di configurazione.

Lo staff legge `tessere` e `accessi_log` ma scrive **solo** tramite le funzioni `staff_*`. Della tabella `terminali` lo staff non vede la colonna dell'hash. Tutto questo è verificato dai test (`npm run test:db`).

## Regole degli esiti

Le regole sono in un'**unica funzione pura**, `decidiAbbonamenti()` in `app/js/esito.js`, usata dalla simulazione e (in fase 2) dal fallback offline. La gemella lato database è `accessi_decidi()`. Gli **stessi casi** (`test/casi-esito.json`) vengono verificati su tutte e due, così le regole non divergono.

1. **Tessera inesistente o disattivata** → ROSSO "Tessera sconosciuta".
2. **Abbonamenti validi oggi** (Europe/Rome; quelli con stato `archiviato` vengono ignorati):
   - a **scadenza**: `data_inizio ≤ oggi ≤ data_scadenza`;
   - a **ingressi** (piano con `entrate > 0`): residuo > 0 ed entro le date.
3. **Priorità**, se ce n'è più di uno: prima quello a scadenza (non consuma nulla), poi quello a ingressi con la scadenza più vicina.
4. **VERDE**:
   - a ingressi: scala 1 e mostra il residuo;
   - a scadenza: mostra la scadenza e i giorni rimasti.
   - Compare una **riga gialla** se mancano meno di 7 giorni o restano 2 ingressi o meno.
5. **ROSSO** con il motivo: "Abbonamento scaduto il gg/mm", "Ingressi esauriti", "Nessun abbonamento", oppure "Abbonamento valido dal gg/mm" se l'abbonamento non è ancora iniziato.
6. **Stessa tessera entro 5 secondi** → ignorata, con un lieve avviso. Il controllo è locale al terminale. La lettura viene registrata come `doppia_lettura`, senza scalare nulla.
7. Dopo **3 secondi** la schermata torna in attesa. Ogni lettura viene registrata in `accessi_log`.

## Lettore RFID

Il lettore USB 125 kHz EM4100 lavora in emulazione tastiera: digita il codice in pochi millisecondi (es. `0003827938`) e poi preme Invio.

- `lettore.js` ascolta la tastiera **globalmente** (funziona anche senza focus) e accumula solo i tasti arrivati a raffica. La soglia è **100 ms** tra un tasto e l'altro, configurabile con `LETTORE_MAX_GAP_MS`. I tasti digitati lentamente a mano vengono ignorati.
- La lettura si chiude con **Invio** oppure con **Tab**, perché alcuni lettori usano quest'ultimo.
- Il codice viene messo in maiuscolo e ripulito dagli spazi. Lunghezza e formato sono liberi e gli **zeri iniziali vengono conservati**.
- Il codice letto può essere diverso dal numero stampato sulla tessera, quindi **le tessere si associano sempre passandole sul lettore**.
- **Prova lettore** (/gestione → Tessere) mostra, per ogni tessera passata, il codice letto, quanti caratteri, quanto tempo ha impiegato il lettore e l'intervallo massimo tra due tasti. Dice anche se la lettura sarebbe stata scartata perché troppo lenta, e se la tessera è associata o a chi; se non lo è, si associa con un clic. Non modifica nulla da sola: serve a verificare un lettore nuovo. Se un lettore risulta "troppo lento", alza `LETTORE_MAX_GAP_MS` (per esempio a 150).

## Sviluppo

Prerequisiti: Node 18+.

```bash
cd accessi
cp .env.example .env          # facoltativo: senza Supabase si lavora in simulazione
npm run dev                   # http://localhost:5174
```

- **Simulazione senza database**: <http://localhost:5174/ingresso/?demo=1>. I dati demo restano in memoria: ricaricando la pagina tornano allo stato iniziale.
- **Pannello simulazione** (`?sim=1`, già incluso in `?demo=1`): pulsante **SIM** in basso a destra, con campo di testo, **Tessera di test 1, 2, 3** e altri casi (esauriti, nessun abbonamento, priorità, in scadenza, disattivata, non ancora attivo, sconosciuta). Il pannello c'è anche in `/gestione/?sim=1`, nel riquadro "Passa la tessera".
- **Con un database di sviluppo** (Supabase locale o un progetto di test):
  ```bash
  # .env: SUPABASE_URL, SUPABASE_ANON_KEY (anon!), DEV_DATABASE_URL
  npm run seed:dev              # dati demo + terminale di sviluppo (token: dev-terminale-SOLO-SVILUPPO)
  ```
  Poi apri `/ingresso/?sim=1` e incolla il token di sviluppo. Lo script del seed **si rifiuta** di girare su host non locali (salvo `--non-locale`) e il file SQL si blocca se non viene lanciato dallo script. I dati demo non vanno **mai** in produzione.
- **Doppio clic** sulla schermata: schermo intero (comodo in sviluppo; nel kiosk lo fa Chrome).

### Test

```bash
npm test          # regole degli esiti, lettore, dataLayer (senza database)
npm run test:db   # funzioni SQL su un Postgres VERO: avvia un cluster temporaneo (serve Postgres installato)
                  # oppure TEST_DATABASE_URL=postgres://... npm run test:db  (DB usa-e-getta: viene azzerato!)
```

`test:db` applica tutte le migrazioni di GymIN (seed escluso) su un Postgres pulito, con un piccolo stub di Supabase (ruoli `anon` e `authenticated`, `auth.uid()`), e verifica:

- la parità JS/SQL;
- tessera sconosciuta e disattivata, scaduto, esauriti, abbonamenti archiviati, priorità;
- la scalatura atomica;
- l'idempotenza (stesso evento inviato due volte, anche in parallelo);
- **12 letture concorrenti** su un carnet da 3 ingressi → esattamente 3 ok e residuo 0;
- la doppia lettura, l'annullo, l'assegnazione con conferma e la sostituzione;
- le tessere non associate;
- i permessi del terminale (anon) e dello staff;
- il seed di sviluppo, che dà gli stessi esiti della demo in memoria;
- **fase 2**:
  - snapshot minimo, senza dati sensibili, con versione;
  - sync idempotente, con l'evento elaborato online e poi reinviato da offline;
  - ordine cronologico;
  - conflitti "da verificare" senza andare sotto zero;
  - tessera disattivata durante l'offline;
  - errori isolati per evento;
  - "Sincronizza ora";
  - un test d'**integrazione** con il terminale completo (sorgente remota, IndexedDB e sincronizzatore) collegato al DB come `anon`: online → offline → riconnessione.

`npm test` copre anche lo scenario offline (`test/offline.test.js`, IndexedDB simulato):

- lettura offline con scalatura locale;
- sincronizzazione idempotente;
- timeout online con fallback e lo stesso `evento_id`;
- carnet esaurito o abbonamento scaduto sul server durante l'offline;
- cache vecchia, cache vuota;
- riavvio con coda piena (60 eventi, inviati in ordine a lotti);
- orologio sfasato;
- backoff;
- doppia lettura offline.

## Deploy

La pubblicazione è automatica su GitHub Pages insieme a GymIN (`.github/workflows/pages.yml`, passo "Build Accessi"):

- <https://loriscuba.github.io/GymIN/accessi/ingresso/>
- <https://loriscuba.github.io/GymIN/accessi/gestione/>
- **Ambiente di test** (stesso progetto Supabase, solo schema `test`, fascia arancione "AMBIENTE DI TEST"):
  <https://loriscuba.github.io/GymIN/test/accessi/ingresso/> e <https://loriscuba.github.io/GymIN/test/accessi/gestione/>.
  Viene costruito dal branch `test` se contiene `accessi/`, altrimenti da `main`. Il token di un terminale vale solo nel proprio schema: un terminale creato in test non funziona in produzione, e viceversa.

La build (`npm run build`) copia `app/` in `dist/` e genera `config.js` dalle Variables `SUPABASE_URL` e `SUPABASE_ANON_KEY` del repo (in mancanza, dal `web/config.js` di GymIN). Aggiunge anche la versione ai link, per invalidare la cache.

Prima di usarlo con i dati veri bisogna **applicare le migrazioni** in Supabase e creare un terminale da `/gestione` (vedi la checklist qui sotto).

### Sezione "Tessere" di GymIN

Nel menu di GymIN la voce **Tessere** mostra la pagina di gestione incorporata (`accessi/gestione/?embed=1`):

- non ha una testata propria;
- usa la stessa sessione e lo stesso tema chiaro/scuro di GymIN;
- il numero di accessi offline da verificare compare sulla voce di menu.

Il codice resta uno solo, in `accessi/`. In sviluppo, `npm run web` di GymIN serve solo `web/`, quindi la sezione appare vuota: per provarla usa il sito di test o `accessi/`.

### Messa in produzione (checklist)

1. **Supabase, schema `public`**: SQL Editor → esegui `supabase/migrations/20261006120000_accessi_terminale.sql`, poi `20261007120000_accessi_offline.sql`. Sono solo aggiunte, nessun dato esistente viene toccato.
2. Apri `/accessi/gestione/` con un utente staff di GymIN e crea il terminale da **Terminali → Nuovo terminale**. Copia il token: viene mostrato una sola volta.
3. **Tessere**: usa "Associazione rapida" per il primo caricamento. Le tessere passate al terminale e non ancora associate finiscono in "Tessere lette non associate".
4. Installa il PC dell'ingresso seguendo il paragrafo successivo.
5. Esegui la **procedura di test offline** sul PC del cliente.

## Installazione dal cliente (PC Windows in kiosk)

Tutto il necessario è nella cartella [`kiosk/`](kiosk/). La guida passo-passo per chi installa è [`kiosk/LEGGIMI.txt`](kiosk/LEGGIMI.txt).

| File | Cosa fa |
|---|---|
| `avvia-ingresso.bat` | Apre Chrome in **modalità kiosk** su `/ingresso`. Usa un **profilo dedicato** (`%LOCALAPPDATA%\GymIN-Ingresso\chrome-profilo`) che non cancella i dati alla chiusura, quindi service worker, cache e coda offline restano sul PC. Passa il flag **`--autoplay-policy=no-user-gesture-required`** per i suoni. Se Chrome si chiude o va in crash lo riapre dopo 5 s, e non apre mai due kiosk. L'URL si cambia nella prima riga di configurazione. |
| `installa-avvio-automatico.bat` | Crea il collegamento "GymIN Ingresso" (finestra ridotta a icona) nella cartella **Esecuzione automatica** (`shell:startup`), più "GymIN Ingresso" e "Ferma GymIN Ingresso" sul Desktop |
| `ferma-ingresso.bat` / `rimuovi-avvio-automatico.bat` | Chiude il kiosk senza che si riapra / toglie l'avvio automatico |
| `configura-windows.bat` | Va eseguito come amministratore. Disattiva sospensione, ibernazione, spegnimento dello schermo e sospensione selettiva USB (il lettore resta sempre attivo). Sincronizza l'orologio in automatico (servizio Ora di Windows, `time.windows.com` e `ntp1.inrim.it`), imposta il fuso di Roma e disattiva lo screen saver |

**Impostazioni Windows da fare a mano** (dettagli in `LEGGIMI.txt`):
- **Account e sessione**: account locale dedicato, non amministratore, con **accesso automatico** (`netplwiz`), nessuna richiesta di accesso al rientro e nessuno screen saver.
- **Schermo**: niente sospensione né spegnimento (lo fa già lo script, ma va verificato).
- **Volume fisso**: livello deciso una volta, combinazione suoni di Windows su "Nessun suono", "Comunicazioni → Non fare nulla", casse come dispositivo predefinito.
- **Notifiche e aggiornamenti**: notifiche disattivate e orario di attività di Windows Update sull'orario di apertura, così i riavvii avvengono a palestra chiusa e il terminale riparte da solo.
- **Orologio**: "Imposta ora automaticamente" e fuso UTC+01:00 Roma. Se l'orologio è sfasato di oltre 3 minuti, il terminale lo segnala.
- **Profilo Chrome**: niente programmi di pulizia sulla cartella del profilo, niente "cancella dati alla chiusura", niente modalità ospite o in incognito.

**La prima apertura deve avvenire online**: installa l'app e scarica i dati. Il token si incolla nella schermata "Configura il terminale".

**Uscire dal kiosk**: tasto Windows (o Alt+Tab) → Desktop → "Ferma GymIN Ingresso". Alt+F4 chiude Chrome, ma lo script lo riapre dopo 5 s.

## Cosa resta in GymIN (non duplicato)

Anagrafica soci, creazione e rinnovo abbonamenti, ricariche dei carnet (rinnovo) e import restano nel gestionale GymIN. Il terminale legge e scala gli stessi `abbonamenti.entrate_residue`.

**Da sapere:** il pulsante "Registra accesso" del gestionale GymIN aggiorna solo la vista in memoria (non scrive su `accessi` e non scala `entrate_residue` nel database). Gli ingressi veri sono quelli del terminale.
