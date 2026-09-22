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
};
