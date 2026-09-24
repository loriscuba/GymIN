(function (global) {
  function normalize(value) {
    return typeof value === 'string' ? value.trim() : value;
  }

  function buildMailerHeaders(cfg = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const customKey = normalize(cfg.MAILER_API_KEY);
    const supabaseKey = normalize(cfg.SUPABASE_ANON_KEY);

    if (customKey) {
      headers['X-Mailer-Key'] = customKey;
      headers.Authorization = `Bearer ${customKey}`;
    }

    if (supabaseKey) {
      headers.apikey = supabaseKey;
      if (!customKey) {
        headers.Authorization = `Bearer ${supabaseKey}`;
      }
    }

    return headers;
  }

  global.buildMailerHeaders = buildMailerHeaders;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildMailerHeaders };
  }
})(typeof window !== 'undefined' ? window : globalThis);
