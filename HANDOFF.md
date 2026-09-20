# GymIN — Handoff / contesto progetto

Documento di passaggio: incollalo (o fallo leggere dal repo) in una nuova chat
per ripartire senza perdere il contesto.

## Cos'è
**GymIN** — gestionale web per palestra (in italiano): anagrafiche soci,
abbonamenti, entrate/accessi, promemoria email, e una **Dashboard** con
fatturato, contratti attivi/scaduti e soci in scadenza.

- **Repo:** https://github.com/loriscuba/gymin (si lavora direttamente su `main`)
- **Demo live:** https://loriscuba.github.io/GymIN/ (GitHub Pages, deploy via Actions)
- **Stack:** HTML/CSS/JS vanilla (no framework), tema chiaro/scuro, accento arancione `#f4511e`.
  Predisposto per **Supabase** (Postgres + Auth + RLS + RPC) con **fallback demo offline**;
  email con **Mailpit + nodemailer + node-cron** (solo lato server/VM).
- **Stato dati:** al momento **demo con dati finti** (Supabase non ancora collegato).
  Le email nella demo sono **anteprime simulate** (un sito statico non invia email).

## Struttura repo (le cose che contano)
```
web/                    # l'app (pubblicata su GitHub Pages)
  index.html            # UI, design tokens, modali, sidebar a scomparsa
  js/app.js             # rendering + interattività (schede, rinnovi, promemoria)
  js/data.js            # loadDemo()/loadSupabase(), piani, generatore dati finti
  js/mailtemplates.js   # template email (benvenuto/rinnovo/ricevuta)
supabase/migrations/    # schema SQL (piani, soci, abbonamenti, pagamenti, accessi, mail_log) + seed
mailer/                 # worker email per la VM (nodemailer + cron)
deploy/                 # script di hosting su Oracle Cloud (vedi sotto)
.github/workflows/
  pages.yml             # deploy della demo su GitHub Pages (funzionante)
  oci-launch.yml        # crea la VM ARM ogni 10 min finché c'è capacità
```

## Funzionalità già fatte
- Dashboard: fatturato, contratti attivi/scaduti, **soci in scadenza** (default 7 giorni, filtri 15/30).
- Anagrafica soci completa ed **editabile** (nome, cognome, telefono, sesso, CF, indirizzo, città, CAP, consenso).
- Abbonamenti tra cui **Carnet 5 entrate** (si consuma con gli accessi); niente più "certificato medico".
- Click sul nome socio → **scheda** del socio; **Rinnovo Rapido** e rinnovo dalla lista in scadenza.
- Icone azione uniformi ovunque (modifica / promemoria / rinnovo rapido / rinnovo completo) con **tooltip testuali**.
- **Promemoria email** singoli e multipli. La mail di rinnovo **NON contiene link** al programma:
  dice di **recarsi in palestra alla reception**.
- **Sidebar a scomparsa** (auto-collapse, si riapre in hover).

## Hosting su Oracle Cloud (cartella `deploy/`)
Obiettivo: una VM Always Free (ARM Ampere) che ospita più progetti demo dietro Nginx.

- `oci-provision.sh` — **NUOVO tenant (es. Amsterdam)**: un solo comando nella
  **OCI Cloud Shell** che crea TUTTA la rete (VCN, Internet Gateway, rotta di
  default, firewall 22/80/443, subnet pubblica) **e** la VM ARM, riprovando
  finché c'è capacità. Idempotente.
  ```bash
  git clone https://github.com/loriscuba/gymin.git
  bash gymin/deploy/oci-provision.sh
  # opzioni: OCPUS=2 MEMORY_GB=12 DISPLAY_NAME=hub SLEEP_SECONDS=180 bash ...
  ```
- `oci-launch-retry.sh` — se la **rete esiste già** e manca solo la VM: retry launcher da Cloud Shell.
- `oci-launch-ci.sh` + `.github/workflows/oci-launch.yml` — crea la VM **dai server di GitHub**
  ogni 10 min (nessun PC acceso); al successo apre una issue → **email di notifica**.
- `host-init.sh` — setup una-tantum della VM (nginx, git, certbot, rsync, firewall).
- `site.sh` / `site-update.sh` — pubblica/aggiorna un progetto come vhost Nginx su un sottodominio.
- `setup.sh` — scorciatoia: prepara la VM **e** pubblica GymIN in un colpo solo.
- `README.md` — guida completa.

### Note Oracle importanti
- Shape gratuita **VM.Standard.A1.Flex** (ARM) spesso satura → "Out of host capacity": si riprova.
- Cloud Shell è in **FIPS mode** → chiavi SSH **RSA** (niente ed25519); gli script lo gestiscono.
- Errore **429 TooManyRequests** = throttling → non scendere sotto ~120s tra i tentativi.
- Il costo stimato "€1.85/mese" mostrato in console è **prezzo di listino**: con Always Free è **€0**.
- La **region non è modificabile** su un account Free (home-region-only) → per Amsterdam serve un **nuovo tenant** (fatto).
- La **porta 25** è bloccata da Oracle: per email usa relay SMTP su **587**.

## Situazione attuale
- Demo pubblicata e funzionante su GitHub Pages.
- Nuovo tenant Oracle su **Amsterdam** creato; pronto lo script `deploy/oci-provision.sh`
  per creare rete + VM in un colpo solo dalla Cloud Shell di Amsterdam.

## Possibili prossimi passi
1. Lanciare `oci-provision.sh` su Amsterdam e prendere l'IP pubblico della VM.
2. Sulla VM: `bash deploy/host-init.sh`, poi pubblicare GymIN con `deploy/setup.sh`.
3. (Opzionale) Adattare `.github/workflows/oci-launch.yml` al tenant di Amsterdam
   per creare la VM senza tenere aperta la Cloud Shell.
4. (Quando si vuole uscire dalla demo) Collegare Supabase: applicare le migration,
   impostare le chiavi in `web/js/data.js`, attivare il mailer sulla VM.

## Aggiornamento — recupero dati legacy + go-live (set 2026)

Lavoro sul branch `claude/friendly-mendel-lf67dq` → **PR #2** (da unire a `main`).

### Migrazione dati dal vecchio gestionale (DBF/FoxPro)
- Recuperati **3.431 soci** (`anagraf.dbf` + note memo `anagraf.fpt`) e **2.842
  abbonamenti** (`tessere.dbf`), collegati via `COD_CLI`; **10 piani** dai servizi.
- Il gestionale legacy è un **sistema di accessi prepagato "a scatti"**, non ad
  abbonamenti a prezzo: **i prezzi non esistono** (listino vuoto) → `piani.prezzo=0`.
- **Carnet "N ingressi"**: entrate = scatti ricaricati (`cnt_bank.dbf`); **residuo
  esatto** riconciliato con `accessi.dbf` (293.761 accessi) = *ricaricati − consumati*
  → 671 scatti su 100 soci. **672 soci senza abbonamento** importati e segnalati.
- Strumenti in `tools/import-legacy/`: `dbf_to_csv.py` (DBF→CSV) + `import.mjs`
  (import Supabase idempotente). Vedi il suo `README.md`.
- Migration `20260918140000_import_legacy.sql`: aggiunge `soci.provincia` e
  `soci.cod_cli` (unique).
- App: l'anagrafica ora mostra anche i **soci senza abbonamento** (badge + filtro).
- ⚠️ **I dati reali dei soci NON sono nel repo** (GDPR): il repo resta pubblico,
  il `.gitignore` di `tools/import-legacy/` esclude `data/`, CSV e DBF.

### Go-live
- Guida passo-passo: **`deploy/GO-LIVE.md`** (test su GitHub Pages + Supabase,
  produzione su Oracle VM + Supabase).
- Scelte: **repo pubblico** (Pages gratis), **niente dominio per ora** (prod su IP
  HTTP), **due progetti Supabase** separati (test/prod).
- `pages.yml` genera `web/config.js` dalle Variables `SUPABASE_URL`/`SUPABASE_ANON_KEY`
  (collega il test a Supabase; senza variabili resta demo).
- Regola d'oro: la `service_role` key solo lato server (`.env`), mai nel repo/frontend.

## Convenzioni
- Commit direttamente su `main` (autorizzato dall'utente).
- Nessun dato reale finché non si collega Supabase.
- Email `loriscuba@gmail.com` usata solo per identità/attribuzione (mai passata a servizi terzi).
- Credenziali Oracle solo nei **GitHub Secrets** (consigliato repo privato per l'infra).
