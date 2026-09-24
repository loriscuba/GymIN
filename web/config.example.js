// Copia questo file in web/config.js e inserisci i valori del tuo progetto Supabase.
// L'app usa sempre il database live: senza config valida il frontend non parte.
// NON mettere qui la service_role key: nel frontend va SOLO la chiave anon (pubblica).
window.GYMIN_CONFIG = {
  SUPABASE_URL: '',       // es. https://xxxx.supabase.co  oppure http://127.0.0.1:54321
  SUPABASE_ANON_KEY: '',  // chiave "anon public"

  // Opzionale: se valorizzato, le mail generate dall'app vengono inviate a Mailpit/HTTP
  // e compaiono nella sua UI (http://localhost:8025).
  // Richiede Mailpit avviato con CORS abilitato (vedi docker-compose.yml).
  MAILPIT_URL: '',        // es. http://localhost:8025

  // Opzionale: endpoint del mailer reale, usato solo quando clicchi "Invia mail reale".
  // La richiesta va ad un backend Node che usa SMTP reale (es. http://localhost:3001/api/send).
  MAILER_API_URL: '',
  MAILER_API_KEY: '',     // opzionale; se impostato, il backend richiede X-Mailer-Key
};
