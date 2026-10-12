# TASK - Cose da fare

## Da fare

- [ ] **Testare il ripristino del backup DB**
  - Scaricare un backup da GitHub → Actions → "Backup notturno database"
  - Ripristinarlo su un progetto Supabase di test (istruzioni in testa a `.github/workflows/backup-db.yml`)
  - Annotare qui data ed esito
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

