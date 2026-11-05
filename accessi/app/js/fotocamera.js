// FOTOCAMERA: legge il QR d'ingresso mostrato dal telefono del socio.
// Il codice letto entra nello STESSO percorso del lettore RFID (onCodice): stesse regole, stessi
// esiti, stessa apertura porta, offline compreso.
//
// Decodifica: BarcodeDetector del browser (Chrome su Android, ChromeOS, macOS) se c'è,
// altrimenti jsQR (vendor/jsQR.js, caricato solo quando serve).

// QR d'ingresso generato da staff_qr_socio(): 'QR' + 32 caratteri esadecimali
const FORMATO_QR = /^QR[0-9A-F]{32}$/;

/** Codice d'ingresso dal testo del QR; null se è un QR qualsiasi (un link, un menù...). */
export function estraiCodiceQr(testo) {
  const c = String(testo ?? '').replace(/\s+/g, '').toUpperCase();
  return FORMATO_QR.test(c) ? c : null;
}

/**
 * Logica pura (testabile): la fotocamera vede lo stesso QR per secondi, ma deve valere UNA lettura.
 * vedi(codice|null, ora) -> codice da consegnare oppure null.
 * Lo stesso QR viene riconsegnato solo dopo essere uscito dall'inquadratura per almeno `assenzaMs`.
 */
export function creaFiltroQr({ assenzaMs = 1500 } = {}) {
  let ultimo = null;
  let vistoIl = -Infinity;
  return {
    vedi(codice, ora) {
      if (!codice) {
        if (ultimo && ora - vistoIl >= assenzaMs) ultimo = null;
        return null;
      }
      const nuovo = codice !== ultimo || ora - vistoIl >= assenzaMs;
      ultimo = codice;
      vistoIl = ora;
      return nuovo ? codice : null;
    },
    reset() { ultimo = null; vistoIl = -Infinity; },
  };
}

let jsQRPromessa = null;
function caricaJsQR(src) {
  jsQRPromessa ??= new Promise((ok, ko) => {
    if (window.jsQR) return ok(window.jsQR);
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => (window.jsQR ? ok(window.jsQR) : ko(new Error('jsQR non caricato')));
    s.onerror = () => ko(new Error('jsQR non caricato'));
    document.head.append(s);
  });
  return jsQRPromessa;
}

async function creaDecodificatore({ jsqrSrc }) {
  if ('BarcodeDetector' in window) {
    try {
      const formati = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formati || formati.includes('qr_code')) {
        const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
        return { tipo: 'nativo', leggi: async (video) => (await bd.detect(video))[0]?.rawValue ?? null };
      }
    } catch { /* si passa a jsQR */ }
  }
  const jsQR = await caricaJsQR(jsqrSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    tipo: 'jsqr',
    async leggi(video) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      const k = Math.min(1, 640 / w);                  // ridotto: più veloce sui tablet economici
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    },
  };
}

/**
 * Logica pura (testabile): la fotocamera è ferma? Su tablet e webcam USB lo stream può bloccarsi
 * senza errori (standby dello schermo, risparmio energetico, driver USB): il video resta congelato.
 * controlla({live, tempoVideo, ora}) -> true se va riavviata:
 *   - traccia non più "live" (finita o muta);
 *   - il tempo del video non avanza da `maxFermoMs`.
 */
export function creaSentinella({ maxFermoMs = 10000 } = {}) {
  let ultimoTempo = null;
  let avanzatoIl = null;
  return {
    controlla({ live, tempoVideo, ora }) {
      if (!live) return true;
      if (tempoVideo !== ultimoTempo || avanzatoIl === null) {
        ultimoTempo = tempoVideo;
        avanzatoIl = ora;
        return false;
      }
      return ora - avanzatoIl >= maxFermoMs;
    },
    reset() { ultimoTempo = null; avanzatoIl = null; },
  };
}

/** Attesa prima del tentativo n (0, 1, 2...) di riaprire la fotocamera. */
export const attesaRiavvio = (n) => [2000, 5000, 10000, 30000][Math.min(n, 3)];

/**
 * Avvia la fotocamera nel <video> e chiama onCodice(codice) per ogni QR d'ingresso nuovo.
 * Se lo stream si blocca o si chiude, la fotocamera viene riaperta da sola; dopo `maxTentativi`
 * riaperture fallite di fila chiama onGuasto() (es. ricaricare la pagina).
 * @param {{video: HTMLVideoElement, onCodice: (c: string) => void, attivo?: () => boolean,
 *          intervalloMs?: number, jsqrSrc?: string, facingMode?: string,
 *          maxFermoMs?: number, maxTentativi?: number, onGuasto?: (e: Error) => void}} opz
 *   attivo(): false = il QR viene visto ma non consegnato (esito a schermo, configurazione)
 * @returns {Promise<{ferma: () => void, tipo: string, stato: object}>}  lancia se la fotocamera non è disponibile
 */
export async function avviaFotocamera({ video, onCodice, attivo = () => true, intervalloMs = 250,
  jsqrSrc = '../vendor/jsQR.js', facingMode = 'user', maxFermoMs = 10000, maxTentativi = 5, onGuasto = null }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Fotocamera non supportata da questo browser');
  let stream = null;
  const stato = { riavvii: 0, ultimoRiavvio: null, errore: null };

  async function apri() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    stream.getVideoTracks()[0]?.addEventListener('ended', () => controllaOra());
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
  }
  await apri();
  const dec = await creaDecodificatore({ jsqrSrc });
  const filtro = creaFiltroQr();
  const sentinella = creaSentinella({ maxFermoMs });
  let fermo = false;
  let timer = null;
  let inRiavvio = false;
  let tentativi = 0;

  async function riavvia(motivo) {
    if (inRiavvio || fermo) return;
    inRiavvio = true;
    console.warn(`Fotocamera ferma (${motivo}): la riapro`);
    while (!fermo) {
      await new Promise((r) => setTimeout(r, attesaRiavvio(tentativi)));
      try {
        await apri();
        tentativi = 0;
        stato.riavvii += 1;
        stato.ultimoRiavvio = new Date().toISOString();
        stato.errore = null;
        break;
      } catch (e) {
        tentativi += 1;
        stato.errore = e.message;
        console.warn(`Fotocamera non riaperta (tentativo ${tentativi}):`, e.message);
        if (tentativi >= maxTentativi) { onGuasto?.(e); tentativi = 0; }
      }
    }
    sentinella.reset();
    inRiavvio = false;
  }

  function controllaOra() {
    if (fermo || inRiavvio) return;
    const t = stream?.getVideoTracks()[0];
    const live = !!t && t.readyState === 'live' && !t.muted;
    if (sentinella.controlla({ live, tempoVideo: video.currentTime, ora: performance.now() })) {
      riavvia(live ? 'immagine bloccata' : 'stream chiuso');
    }
  }
  // tornando visibile (schermo riacceso, scheda di nuovo in primo piano) si controlla subito
  const suVisibile = () => { if (document.visibilityState === 'visible') { video.play().catch(() => {}); controllaOra(); } };
  document.addEventListener('visibilitychange', suVisibile);

  async function giro() {
    if (fermo) return;
    try {
      if (!inRiavvio && video.readyState >= 2) {
        // si continua a guardare anche mentre è mostrato l'esito: chi tiene il telefono davanti
        // alla fotocamera non viene letto una seconda volta (sarebbe "QR già usato")
        const testo = await dec.leggi(video);
        const c = filtro.vedi(estraiCodiceQr(testo), performance.now());
        if (c && attivo()) onCodice(c);
      }
      if (document.visibilityState !== 'hidden') controllaOra();
    } catch (e) {
      console.warn('Lettura QR:', e.message);
    }
    timer = setTimeout(giro, intervalloMs);
  }
  giro();

  return {
    tipo: dec.tipo,
    stato,
    ferma() {
      fermo = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', suVisibile);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
