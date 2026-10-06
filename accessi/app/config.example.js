// Configurazione runtime del terminale. In sviluppo e in build viene GENERATA da .env
// (vedi scripts/dev-server.mjs e scripts/build.mjs): non serve copiarla a mano.
// Qui va SOLO la chiave anon (pubblica). Il token del terminale NON va qui:
// si inserisce una volta sul PC del cliente e resta salvato nel browser.
window.ACCESSI_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  DB_SCHEMA: '',
  TIMEOUT_ONLINE_MS: 2000,
  RITARDO_SUONI_MS: 150,
  DURATA_ESITO_MS: 3000,
  CACHE_MAX_ORE: 72,
  SYNC_INTERVALLO_MS: 60000,
};
