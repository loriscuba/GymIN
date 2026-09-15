// Copia questo file in web/config.js e inserisci i valori del tuo progetto Supabase.
// Se config.js non esiste, l'app parte comunque in MODALITÀ DEMO (dati finti generati).
// NON mettere qui la service_role key: nel frontend va SOLO la chiave anon (pubblica).
window.GYMIN_CONFIG = {
  SUPABASE_URL: '',       // es. https://xxxx.supabase.co  oppure http://127.0.0.1:54321
  SUPABASE_ANON_KEY: '',  // chiave "anon public"

  // Opzionale (anche in modalità demo): se valorizzato, le mail generate dall'app
  // vengono inviate DAVVERO a Mailpt e compaiono nella sua UI (http://localhost:8025).
  // Richiede Mailpit avviato con CORS abilitato (vedi docker-compose.yml).
  MAILPIT_URL: '',        // es. http://localhost:8025
};
