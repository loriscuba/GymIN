# GymIN — Gestionale palestra

Gestionale per palestre: anagrafiche soci, abbonamenti, accessi, dashboard (fatturato, contratti attivi/scaduti) e **email automatiche** agli iscritti (benvenuto, ricevute, promemoria rinnovo, avvisi di scadenza).

**Stack:** frontend statico (HTML/JS) · **Supabase** (PostgreSQL + Auth) · worker Node per le mail · **Mailpit** in sviluppo.

```
gymin/
├─ web/                 # frontend (legge da Supabase; fallback "modalità demo")
│  ├─ index.html
│  ├─ config.example.js # → copia in config.js con le tue chiavi Supabase
│  └─ js/               # data (Supabase + demo) · app (UI)
├─ mailer/              # worker Node: scheduler + invio mail via SMTP (Mailpit)
├─ supabase/migrations/ # schema + dati demo (SQL)
├─ docker-compose.yml   # Mailpit (SMTP :1025 · UI :8025)
└─ .env.example
```

## Architettura in breve

- Il **frontend** parla direttamente con Supabase (auth staff + query con RLS).
- Il **mailer** è un processo Node separato: usa la *service_role key* (bypassa RLS), interroga il DB ogni mattina e invia le mail al relay SMTP.
- In **sviluppo** il relay è **Mailpit**: nessuna mail esce davvero, le ispezioni dal browser.
- In **produzione** si cambia solo l'host SMTP nel `.env` (OCI Email Delivery / Brevo / SES) — il codice non cambia.

## Avvio rapido (sviluppo locale)

Prerequisiti: Node 18+, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# 1) dipendenze
npm install

# 2) Mailpit (cattura le mail) → UI su http://localhost:8025
npm run mailpit:up

# 3) Supabase locale (applica automaticamente le migrazioni in supabase/migrations)
supabase start

# 4) variabili d'ambiente
cp .env.example .env
#   incolla i valori da `supabase status`:
#   - API URL            → SUPABASE_URL
#   - service_role key   → SUPABASE_SERVICE_ROLE_KEY   (solo mailer!)

# 5) frontend: chiavi pubbliche
cp web/config.example.js web/config.js
#   inserisci API URL (SUPABASE_URL) e anon key

# 6) avvia il frontend  → http://localhost:5173
npm run web
```

> Senza `web/config.js` il frontend parte comunque in **modalità demo** con dati finti: utile per vedere subito la UI senza configurare nulla.

### Modalità demo interattiva

Anche senza Supabase la demo è pienamente operativa (stato in memoria):

- **Nuovo socio** → form con scelta abbonamento; calcola la scadenza, aggiorna dashboard e fatturato, e genera la **mail di benvenuto**.
- **Registra accesso** → l'esito (valido / negato) dipende dallo stato dell'abbonamento del socio.
- **Invia promemoria** → genera le mail di rinnovo per i soci in scadenza.
- **Posta** → elenco delle mail generate, con **anteprima del template reale**.

Le mail in demo sono anteprime. Per farle arrivare **davvero** in Mailpit senza backend, avvia Mailpit (`npm run mailpit:up`) e imposta `MAILPIT_URL: 'http://localhost:8025'` in `web/config.js`: l'app userà l'API HTTP di Mailpit.

### Utente staff (per il login)

Con Supabase locale crea un utente dalla dashboard (`http://localhost:54323` → Authentication → Add user) oppure via SQL. Le policy RLS danno accesso completo agli utenti **autenticati**.

## Email automatiche

```bash
npm run mail:test        # invia una mail di prova di ogni tipo → guardala su Mailpit
npm run mail:once        # esegue subito il job giornaliero (rinnovi + scaduti)
npm run mail:dev         # avvia lo scheduler (default: ogni giorno alle 08:00, vedi MAIL_CRON)
```

Tipi di mail gestiti:

| Tipo | Quando | Origine |
|------|--------|---------|
| Benvenuto | alla creazione del socio | evento (da collegare) |
| Ricevuta | a ogni pagamento | evento (da collegare) |
| Promemoria rinnovo | 15 / 7 / 1 giorni prima della scadenza | scheduler |
| Avviso scaduto | il giorno dopo la scadenza | scheduler |

La tabella `mail_log` registra ogni invio (con chiave anti-doppione in `rif`) così la stessa mail non parte due volte. La logica di selezione vive nelle funzioni SQL `abbonamenti_in_scadenza(giorni)` e `abbonamenti_scaduti()`.

## Verso la produzione

1. Progetto Supabase in cloud (`supabase link` + `supabase db push`).
2. Dominio dedicato con **SPF, DKIM e DMARC** configurati sul provider mail.
3. `.env` di produzione con l'SMTP del relay (porta 587).
4. Mailer come servizio persistente (systemd / PM2) sulla VM, oppure come Supabase Edge Function schedulata con `pg_cron`.
5. Frontend servito da Nginx con HTTPS (Let's Encrypt).
