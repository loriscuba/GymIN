#!/usr/bin/env node
// Server di sviluppo: serve app/ e genera /config.js da .env. Nessuna dipendenza.
//   npm run dev  ->  http://localhost:5174/ingresso/?sim=1
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { ROOT, leggiEnv, configJs } from './env.mjs';

const APP = join(ROOT, 'app');
const env = leggiEnv();
const PORT = Number(env.PORT || 5174);
const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/config.js') {
    res.writeHead(200, { 'content-type': TIPI['.js'], 'cache-control': 'no-store' });
    return res.end(configJs(leggiEnv()));
  }
  if (path === '/') { res.writeHead(302, { location: '/ingresso/' }); return res.end(); }
  let file = normalize(join(APP, path));
  if (!file.startsWith(APP)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) {
      if (!path.endsWith('/')) { res.writeHead(301, { location: path + '/' }); return res.end(); }
      file = join(file, 'index.html');
    }
    const body = (await readFile(file)).toString('binary').replaceAll('__BUILD__', 'dev');
    res.writeHead(200, { 'content-type': TIPI[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body, 'binary');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Non trovato');
  }
}).listen(PORT, () => {
  console.log(`GymIN Accessi (sviluppo) su http://localhost:${PORT}`);
  console.log(`  terminale:   http://localhost:${PORT}/ingresso/      (simulazione: ?sim=1)`);
  console.log(`  gestione:    http://localhost:${PORT}/gestione/`);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) console.log('  .env senza Supabase: il terminale funziona solo in simulazione con dati demo in memoria (?sim=1).');
});
