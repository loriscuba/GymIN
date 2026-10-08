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
  LETTORE_MAX_GAP_MS: 100,
  // apriporta (relè Shelly in LAN): SHELLY_URL vuoto = spento
  PORTA_TIPO: '',
  SHELLY_URL: '',
  SHELLY_GEN: 2,
  SHELLY_CANALE: 0,
  PORTA_IMPULSO_S: 1,
  PORTA_TIMEOUT_MS: 1500,
};
