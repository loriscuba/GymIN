# TASK - Cose da fare

## Da fare

- [x] **Testare il ripristino del backup DB** — fatto il 18/10/2026, esito **OK**
  - Backup provato: `gymin_2026-10-18.dump.gpg` (run 39106913971, 644 KB)
  - Ripristinato con il workflow "Prova ripristino backup" in un Postgres 17 usa e getta
    ([run 39130631790](https://github.com/loriscuba/GymIN/actions/runs/39130631790)): decifratura ok,
    `pg_restore` senza errori, 15 tabelle, 18 policy RLS, utenti staff presenti,
    numero di righe identico a produzione in tutte le 15 tabelle
  - Non si ripristina nello schema `test`: è nello stesso progetto di produzione e il dump
    (con `--clean`) riscriverebbe `public` e `auth`
  - Per ripeterlo: Actions → "Prova ripristino backup" → Run workflow
- [ ] **Configurare Bitwarden**
  - Creare l'account e salvare la `BACKUP_PASSPHRASE` (e le altre credenziali del progetto)
  - Conservare anche una copia cartacea della passphrase in un luogo sicuro
- [ ] **Configurare Cloudflare**
  - Aggiungere GymIN a Cloudflare Pages (il workflow `pages.yml` è già pronto: carica su Cloudflare lo stesso sito di GitHub Pages)
    1. Cloudflare → Workers & Pages → Create → Pages → **Upload assets** (Direct Upload), nome progetto **`gymin`**; carica una cartella qualsiasi (verrà sovrascritta)
    2. Copiare l'**Account ID** (pagina Workers & Pages, colonna a destra)
    3. My Profile → API Tokens → Create Token → modello "Edit Cloudflare Workers" (o token custom con permesso *Account → Cloudflare Pages → Edit*)
    4. GitHub → Settings → Secrets and variables → Actions → New repository secret: `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`
    5. GitHub → Actions → "Deploy web su GitHub Pages" → Run workflow; verificare che il sito risponda su `https://gymin.pages.dev` (e `/test/`, `/accessi/`)
    6. Supabase → Authentication → URL Configuration: aggiungere `https://gymin.pages.dev/**` ai Redirect URLs
    7. Supabase → Edge Functions → Secrets: aggiungere `https://gymin.pages.dev` a `ALLOWED_ORIGINS` (separato da virgola), altrimenti l'invio email dal nuovo dominio viene bloccato
    8. (Opzionale) Pages → Custom domains per usare un dominio proprio; poi ripetere i punti 6–7 con quel dominio

## Fatto

