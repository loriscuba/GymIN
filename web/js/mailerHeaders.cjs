(function (global) {
  function normalize(value) {
    return typeof value === 'string' ? value.trim() : value;
  }

  // accessToken: token della sessione dello staff (supabase.auth.getSession()).
  // La funzione send-mail accetta solo utenti autenticati: la chiave anon è pubblica
  // e non basta più per inviare email.
  function buildMailerHeaders(cfg = {}, accessToken = '') {
    const headers = { 'Content-Type': 'application/json' };
    const customKey = normalize(cfg.MAILER_API_KEY);
    const supabaseKey = normalize(cfg.SUPABASE_ANON_KEY);
    const token = normalize(accessToken);

    if (customKey) {
      headers['X-Mailer-Key'] = customKey;
    }

    if (supabaseKey) {
      headers.apikey = supabaseKey;
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else if (customKey) {
      headers.Authorization = `Bearer ${customKey}`;
    }

    return headers;
  }

  global.buildMailerHeaders = buildMailerHeaders;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildMailerHeaders };
  }
})(typeof window !== 'undefined' ? window : globalThis);
