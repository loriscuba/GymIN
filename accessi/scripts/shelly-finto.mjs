#!/usr/bin/env node
// SHELLY FINTO — emula in locale il relè Shelly che apre la porta, per sviluppare e testare
// il terminale SENZA l'hardware. Nessuna dipendenza.
//
//   npm run shelly:finto                     # http://localhost:8089  (pagina con lo stato della porta)
//   npm run shelly:finto -- --ritardo=3000   # risponde lento (prova il timeout del terminale)
//   npm run shelly:finto -- --errore         # risponde HTTP 500
//   npm run shelly:finto -- --porta=8090
//
// Endpoint come uno Shelly vero:
//   Gen2/3/4: GET /rpc/Switch.Set?id=0&on=true&toggle_after=1 · GET /rpc/Switch.GetStatus?id=0
//             GET /rpc/Shelly.GetDeviceInfo · POST /rpc {"method":"Switch.Set","params":{...}}
//   Gen1:     GET /relay/0?turn=on&timer=1 · GET /shelly
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const ORA = () => new Date().toLocaleTimeString('it-IT');

/**
 * @param {{ritardoMs?: number, errore?: boolean, log?: (s: string) => void}} opz
 * @returns {{server: import('node:http').Server, stato: object, aperture: Array}}
 */
export function creaShellyFinto({ ritardoMs = 0, errore = false, log = () => {} } = {}) {
  const stato = { output: false, spegniAlle: null };
  const aperture = [];
  let timer = null;

  function imposta(on, dopoS) {
    clearTimeout(timer);
    const prima = stato.output;
    stato.output = !!on;
    stato.spegniAlle = null;
    if (dopoS > 0) {
      stato.spegniAlle = Date.now() + dopoS * 1000;
      timer = setTimeout(() => { stato.output = !on; stato.spegniAlle = null; log(`${ORA()}  relè ${stato.output ? 'ON' : 'OFF'} (fine impulso)`); }, dopoS * 1000);
      timer.unref?.();
    }
    if (on) aperture.push({ quando: new Date().toISOString(), impulsoS: dopoS || null });
    log(`${ORA()}  relè ${on ? 'ON  🔓 PORTA APERTA' : 'OFF'}${dopoS ? ` per ${dopoS} s` : ''}`);
    return { was_on: prima };
  }

  const statoSwitch = (id) => ({ id, source: 'http', output: stato.output, apower: 0, voltage: 230, temperature: { tC: 40 } });
  const info = { name: 'Shelly finto', id: 'shellyfinto-000000', mac: '000000000000', model: 'SIMULATO', gen: 2, fw_id: 'finto', app: 'Finto', auth_en: false };

  function rpc(metodo, p) {
    const id = Number(p.id ?? 0);
    switch (metodo) {
      case 'Switch.Set': {
        const on = p.on === true || p.on === 'true';
        return imposta(on, Number(p.toggle_after) || 0);
      }
      case 'Switch.Toggle': return imposta(!stato.output, 0);
      case 'Switch.GetStatus': return statoSwitch(id);
      case 'Shelly.GetDeviceInfo': return info;
      default: return null;
    }
  }

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const intestazioni = {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-allow-private-network': 'true',
      'cache-control': 'no-store',
    };
    const rispondi = (codice, corpo, tipo) => {
      res.writeHead(codice, tipo ? { ...intestazioni, 'content-type': tipo } : intestazioni);
      res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    };
    if (req.method === 'OPTIONS') return rispondi(204, '');
    if (u.pathname === '/') return rispondi(200, PAGINA, 'text/html; charset=utf-8');
    if (u.pathname === '/finto/stato') return rispondi(200, { ...stato, aperture: aperture.slice(-20).reverse() });

    if (ritardoMs) await new Promise((r) => setTimeout(r, ritardoMs));
    if (errore) { log(`${ORA()}  ${req.method} ${u.pathname} → 500 (errore simulato)`); return rispondi(500, { code: -1, message: 'errore simulato' }); }

    const p = Object.fromEntries(u.searchParams);
    let risultato = null;
    if (u.pathname === '/rpc' && req.method === 'POST') {
      let body = '';
      for await (const c of req) body += c;
      try {
        const j = JSON.parse(body || '{}');
        risultato = rpc(j.method, j.params || {});
        if (risultato) return rispondi(200, { id: j.id ?? 1, src: info.id, result: risultato });
      } catch { return rispondi(400, { code: -103, message: 'JSON non valido' }); }
    } else if (u.pathname.startsWith('/rpc/')) {
      risultato = rpc(u.pathname.slice(5), p);
    } else if (/^\/relay\/\d+$/.test(u.pathname)) {          // Gen1
      if (p.turn === 'on' || p.turn === 'off') imposta(p.turn === 'on', Number(p.timer) || 0);
      else if (p.turn === 'toggle') imposta(!stato.output, 0);
      risultato = { ison: stato.output, has_timer: !!stato.spegniAlle, timer_duration: 0, source: 'http' };
    } else if (u.pathname === '/shelly') {
      risultato = { type: 'SHSW-1', mac: info.mac, auth: false, fw: 'finto' };
    }
    if (!risultato) return rispondi(404, { code: 404, message: `Metodo sconosciuto: ${u.pathname}` });
    rispondi(200, risultato);
  });
  return { server, stato, aperture };
}

const PAGINA = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shelly finto</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;display:grid;place-items:center;min-height:100vh;background:#14181f;color:#eee}
.box{text-align:center}.porta{font-size:72px;font-weight:800;padding:40px 60px;border-radius:24px;background:#3a1d1d;transition:background .15s}
.porta.on{background:#16a34a}ul{list-style:none;padding:0;color:#aaa;font-size:14px}</style></head>
<body><div class="box"><p>Shelly finto · relè 0</p><div id="p" class="porta">CHIUSA</div><ul id="l"></ul></div>
<script>
async function t(){try{const s=await (await fetch('/finto/stato')).json();const p=document.getElementById('p');
p.textContent=s.output?'🔓 APERTA':'CHIUSA';p.className='porta'+(s.output?' on':'');
document.getElementById('l').innerHTML=s.aperture.map(a=>'<li>'+new Date(a.quando).toLocaleTimeString('it-IT')+' · aperta'+(a.impulsoS?' per '+a.impulsoS+' s':'')+'</li>').join('');}catch{}}
setInterval(t,200);t();
</script></body></html>`;

// avvio da riga di comando
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n) => process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  const val = (n, d) => { const a = arg(n); return a && a.includes('=') ? a.split('=')[1] : d; };
  const porta = Number(val('porta', process.env.SHELLY_FINTO_PORTA || 8089));
  const { server } = creaShellyFinto({ ritardoMs: Number(val('ritardo', 0)), errore: !!arg('errore'), log: console.log });
  server.listen(porta, () => {
    console.log(`Shelly finto su http://localhost:${porta}  (apri la pagina per vedere la porta)`);
    console.log(`  terminale: SHELLY_URL=http://localhost:${porta} nel .env di accessi/, poi npm run dev`);
    console.log(`  oppure:    http://localhost:5174/ingresso/?demo=1&shelly=http://localhost:${porta}`);
    console.log(`  a mano:    curl "http://localhost:${porta}/rpc/Switch.Set?id=0&on=true&toggle_after=1"`);
  });
}
