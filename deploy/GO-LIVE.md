# GymIN · Guida go-live passo-passo

Guida operativa per pubblicare **test** (GitHub Pages + Supabase) e **produzione**
(Oracle VM + Supabase). Pensata per essere seguita in ordine.

## Scelte di questo setup
- **Repo pubblico** (non contiene dati né segreti): GitHub Pages resta gratuito.
  Le credenziali Oracle vivono nei *GitHub Secrets* (cifrati anche su repo pubblici);
  i dati dei soci non sono nel repo; nel frontend gira solo la chiave `anon` (pubblica).
- **Niente dominio per ora**: la produzione gira sull'**IP pubblico** della VM (HTTP),
  il test su URL `*.github.io`. L'HTTPS con dominio si aggiunge dopo (§6).
- **Due progetti Supabase separati**: uno TEST e uno PROD (consigliato: non mescolare
  dati veri e di prova).

> ⚠️ **Segreti — regola d'oro.** La `service_role key` di Supabase bypassa ogni
> sicurezza (RLS): va usata **solo** lato server (importatore, mailer), messa nei
> file `.env` **mai** committati. Nel frontend/Pages va **solo** la chiave `anon`.

## Cosa ti serve prima di iniziare
- Account **GitHub** (già ok), account **Supabase** (supabase.com), account **Oracle Cloud**
  (tenant Amsterdam già creato).
- Sul tuo PC: `git`, e i CSV dei dati già generati (`soci.csv`, `piani.csv`,
  `abbonamenti.csv`) + i `.dbf` legacy per rigenerarli. **Node 18+** e **Python 3**
  per l'importatore.

---

## 0 · Prepara il codice (una volta)

Il deploy pubblica dal branch **main**. Le funzionalità nuove (import legacy, soci
senza abbonamento, config.js su Pages) stanno nella PR #2: **va unita a main prima**.

1. Apri la PR: https://github.com/loriscuba/GymIN/pull/2
2. Togli lo stato *draft* → **Ready for review** → **Merge**.
3. Sul PC: `git checkout main && git pull`.

---

## 1 · Supabase — progetto di TEST

1. supabase.com → **New project** → nome `gymin-test`, scegli una password DB e la
   region (EU, es. Frankfurt). Attendi il provisioning.
2. **Prendi le chiavi**: Project Settings → **API**:
   - `Project URL` → è `SUPABASE_URL`
   - `anon public` → è `SUPABASE_ANON_KEY` (pubblica)
   - `service_role` → **segreta**, serve solo per l'import (§1.4)
3. **Applica lo schema** (le migration in `supabase/migrations/`). Modo semplice
   senza CLI: SQL Editor → incolla e **Run**, in ordine, il contenuto di:
   1. `20260915120000_init.sql`
   2. `20260915120100_seed.sql`  *(piani demo: opzionale, puoi saltarlo)*
   3. `20260915130000_anagrafica_fields.sql`
   4. `20260918140000_import_legacy.sql`

   *(In alternativa, con la Supabase CLI: `supabase link` poi `supabase db push`.)*
4. **Crea un utente staff** (per il login dell'app): Authentication → **Users** →
   *Add user* → email + password (Confirm = true). Serviranno per accedere.
5. **Importa i dati** (dal tuo PC):
   ```bash
   cd tools/import-legacy
   npm install
   # metti i .dbf legacy in ./data/ (anagraf.dbf, anagraf.fpt, tessere.dbf,
   # cnt_bank.dbf, accessi.dbf) — vedi tools/import-legacy/README.md
   python3 dbf_to_csv.py --in ./data --out ./data/out

   printf 'SUPABASE_URL=...\nSUPABASE_SERVICE_ROLE_KEY=...\n' > .env   # chiavi del progetto TEST
   npm run import:dry     # anteprima
   npm run import         # carica soci + piani + abbonamento corrente per socio
   ```
6. **Verifica**: Table editor → `soci` deve avere ~3.400 righe; `abbonamenti` popolata.

---

## 2 · Ambiente di TEST su GitHub Pages

1. Repo → **Settings → Secrets and variables → Actions → tab _Variables_** →
   *New repository variable* (sono **Variables**, non Secrets: la `anon` è pubblica):
   - `SUPABASE_URL` = Project URL del progetto **TEST**
   - `SUPABASE_ANON_KEY` = chiave `anon` del progetto **TEST**
2. Repo → **Settings → Pages** → *Build and deployment* → Source = **GitHub Actions**.
3. Lancia il deploy: **Actions → “Deploy web su GitHub Pages” → Run workflow**
   (oppure fai un push su `main`). Il workflow genera `web/config.js` dalle Variables
   e pubblica.
4. Apri l'URL Pages (Settings → Pages mostra il link, tipo
   `https://loriscuba.github.io/GymIN/`). Deve comparire la **schermata di login**
   (non più il badge “demo”): accedi con l'utente staff creato al §1.4.

> Chiunque può raggiungere la pagina di login (il sito è pubblico), ma **serve un
> account** Supabase per entrare, e RLS espone i dati solo agli autenticati.

---

## 3 · Supabase — progetto di PRODUZIONE

Ripeti il §1 creando un **secondo** progetto `gymin-prod`:
- stesse migration (punti 1.1→1.3 + `20260918140000_import_legacy.sql`);
- crea gli utenti staff **reali**;
- importa i dati **veri** con l'importatore puntando al `.env` del progetto PROD.

Tieni separate le chiavi TEST e PROD. La `service_role` PROD non deve mai finire
nel frontend né nel repo.

---

## 4 · Produzione su Oracle VM

### 4.1 Crea la VM (dalla OCI Cloud Shell del tenant Amsterdam)
```bash
git clone https://github.com/loriscuba/GymIN.git
bash GymIN/deploy/oci-provision.sh          # crea rete + VM ARM, riprova se "out of capacity"
```
Al successo stampa **IP pubblico** e il comando `ssh`. Se la rete esiste già e manca
solo la VM: `bash GymIN/deploy/oci-launch-retry.sh`.

> Nella console OCI apri le porte **80/443** nella **Security List** della VCN
> (host-init apre il firewall di sistema, ma la Security List è separata).

### 4.2 Prepara la VM e pubblica GymIN (via SSH sulla VM)
```bash
git clone https://github.com/loriscuba/GymIN.git ~/gymin
cd ~/gymin
bash deploy/host-init.sh --node        # nginx, certbot, rsync, firewall + Node.js (per il mailer)
sudo bash deploy/site.sh gymin <IP_PUBBLICO> --src ~/gymin
```
Ora `http://<IP_PUBBLICO>` mostra GymIN (in **demo**, finché non aggiungi config.js).

### 4.3 Collega la produzione a Supabase PROD
Crea il file di config **sulla VM** (non nel repo) e ripubblica:
```bash
sudo tee /var/www/gymin/config.js >/dev/null <<'EOF'
window.GYMIN_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',   // progetto PROD
  SUPABASE_ANON_KEY: 'chiave-anon-PROD',
  MAILPIT_URL: ''
};
EOF
sudo systemctl reload nginx
```
> `site.sh`/`site-update.sh` sincronizzano `web/` dal repo ma **non** toccano un
> `config.js` che aggiungi a mano in `/var/www/gymin/`. Se un giorno usi
> `--delete` in rsync, ricrea il file. In alternativa tieni una copia in
> `~/gymin/config.prod.js` e ricopiala dopo ogni update.

### 4.4 Mailer (promemoria email) — opzionale ma consigliato
La porta **25 è bloccata da Oracle**: usa un **relay SMTP su 587** (es. Brevo,
Mailgun, SendGrid, o l'SMTP del tuo provider).
```bash
cd ~/gymin && npm install       # le dipendenze del mailer sono nel package.json della root
printf '%s\n' \
  'SUPABASE_URL=https://xxxx.supabase.co' \
  'SUPABASE_SERVICE_ROLE_KEY=service-role-PROD' \
  'SMTP_HOST=smtp-relay.tuoprovider.com' \
  'SMTP_PORT=587' \
  'SMTP_USER=...' 'SMTP_PASS=...' \
  'MAIL_FROM=GymIN <no-reply@tuodominio>' \
  'MAIL_CRON=0 8 * * *' > ~/gymin/.env
node mailer/index.js test tua@email   # invio di prova
```
Per tenerlo attivo 24/7 crea un servizio systemd:
```bash
sudo tee /etc/systemd/system/gymin-mailer.service >/dev/null <<EOF
[Unit]
Description=GymIN mailer
After=network.target
[Service]
WorkingDirectory=$HOME/gymin
EnvironmentFile=$HOME/gymin/.env
ExecStart=/usr/bin/node mailer/index.js watch
Restart=always
User=$USER
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now gymin-mailer
journalctl -u gymin-mailer -f    # log
```

### 4.5 Aggiornare la produzione dopo un push
```bash
cd ~/gymin && sudo bash deploy/site-update.sh gymin
# se hai config.js a mano e usi rsync --delete, ricrealo (vedi 4.3)
sudo systemctl restart gymin-mailer   # solo se hai toccato il mailer
```

---

## 5 · Ordine consigliato per domani (checklist)
- [ ] 0. Merge PR #2 in `main`, `git pull` sul PC
- [ ] 1. Supabase **TEST**: progetto, migration, utente staff, import dati
- [ ] 2. GitHub Pages: Variables (URL+anon TEST), Source=Actions, Run workflow, login OK
- [ ] 3. Supabase **PROD**: progetto, migration, utenti reali, import dati veri
- [ ] 4. Oracle: `oci-provision.sh` → IP; `host-init.sh` → `site.sh`; `config.js` PROD; mailer
- [ ] 5. Verifica finale (sotto)

## 6 · Dopo (quando avrai un dominio)
- DNS: record **A** `gymin.tuodominio.it` → IP della VM.
- HTTPS: `sudo certbot --nginx -d gymin.tuodominio.it`.
- Aggiorna `server_name` nel vhost (rilancia `site.sh gymin gymin.tuodominio.it --src ~/gymin`).

---

## Verifica finale
- **Test**: URL Pages → login staff → Dashboard con numeri reali dal DB TEST.
- **Prod**: `http://<IP>` → login staff → dati reali; badge “demo” assente.
- **Mailer**: `journalctl -u gymin-mailer -f` senza errori; mail di prova ricevuta.
- **Sicurezza**: `service_role` solo nei `.env` (VM/PC), mai nel repo né in `config.js`;
  RLS attiva (utenti non autenticati non vedono dati).

## Problemi comuni
- **Pages mostra ancora “demo”** → Variables non impostate o workflow non rilanciato
  dopo averle aggiunte. Controlla il log del job (deve dire “config.js generato”).
- **Login fallisce** → utente non creato in Supabase Auth, o chiavi/URL del progetto
  sbagliati (test vs prod).
- **La VM non si crea (“Out of host capacity”)** → è normale su ARM Free: gli script
  riprovano; oppure usa il workflow `oci-launch.yml` (crea la VM dai server GitHub).
- **Le mail non partono** → porta 25 bloccata: usa un relay su **587**; verifica
  `SMTP_*` nel `.env`.
- **Import: errori di chiave unica** → stai reimportando: `soci` fa upsert su `cod_cli`;
  per gli abbonamenti usa `npm run import:replace` (vedi README dell'importatore).
