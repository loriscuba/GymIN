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
 * Avvia la fotocamera nel <video> e chiama onCodice(codice) per ogni QR d'ingresso nuovo.
 * @param {{video: HTMLVideoElement, onCodice: (c: string) => void, attivo?: () => boolean,
 *          intervalloMs?: number, jsqrSrc?: string, facingMode?: string}} opz
 *   attivo(): false = il QR viene visto ma non consegnato (esito a schermo, configurazione)
 * @returns {Promise<{ferma: () => void, tipo: string}>}  lancia se la fotocamera non è disponibile
 */
export async function avviaFotocamera({ video, onCodice, attivo = () => true, intervalloMs = 250,
  jsqrSrc = '../vendor/jsQR.js', facingMode = 'user' }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Fotocamera non supportata da questo browser');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  const dec = await creaDecodificatore({ jsqrSrc });
  const filtro = creaFiltroQr();
  let fermo = false;
  let timer = null;

  async function giro() {
    if (fermo) return;
    try {
      if (video.readyState >= 2) {
        // si continua a guardare anche mentre è mostrato l'esito: chi tiene il telefono davanti
        // alla fotocamera non viene letto una seconda volta (sarebbe "QR già usato")
        const testo = await dec.leggi(video);
        const c = filtro.vedi(estraiCodiceQr(testo), performance.now());
        if (c && attivo()) onCodice(c);
      }
    } catch (e) {
      console.warn('Lettura QR:', e.message);
    }
    timer = setTimeout(giro, intervalloMs);
  }
  giro();

  return {
    tipo: dec.tipo,
    ferma() {
      fermo = true;
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
