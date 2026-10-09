// Service worker del terminale: /ingresso (e gli asset di /gestione) si caricano anche
// senza internet e dopo il riavvio del PC offline. La prima apertura deve avvenire online.
// Strategia: precache versionato (cache-first); a ogni deploy cambia la versione, il nuovo
// SW scarica tutto e la pagina si ricarica appena il terminale è in attesa.
// Le chiamate al database (Supabase) NON passano mai dalla cache.
const VERSIONE = '__BUILD__';
// produzione (/accessi/) e test (/test/accessi/) sono sullo stesso dominio: cache separate per scope
const PREFISSO = `gymin-accessi:${self.registration.scope}`;
const CACHE = `${PREFISSO}:${VERSIONE}`;
const FILE = [
  './', 'ingresso/', 'gestione/', 'config.js', 'manifest.webmanifest',
  'css/base.css', 'css/terminale.css', 'css/gestione.css',
  'js/esito.js', 'js/lettore.js', 'js/suoni.js', 'js/dataLayer.js', 'js/demo.js', 'js/archivio.js', 'js/sync.js',
  'js/ingresso.js', 'js/gestione.js', 'js/meteo.js',
  'img/logo.png', 'img/icon-192.png', 'img/icon-512.png', 'img/icon-maskable-512.png',
  'vendor/supabase.js', 'fonts/fonts.css',
  'fonts/archivo-latin-600-normal.woff2', 'fonts/archivo-latin-700-normal.woff2', 'fonts/archivo-latin-800-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2', 'fonts/ibm-plex-sans-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((chiavi) => Promise.all(chiavi.filter((k) => k.startsWith(PREFISSO) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // solo i file dell'app (stessa origine e dentro lo scope); il resto (Supabase, CDN) va in rete
  if (url.origin !== location.origin || !req.url.startsWith(self.registration.scope)) return;

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const inCache = await c.match(req, { ignoreSearch: true });
    if (inCache) return inCache;
    try {
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === 'navigate') return (await c.match('ingresso/')) || Response.error();
      throw err;
    }
  })());
});
