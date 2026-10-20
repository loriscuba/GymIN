// QR d'ingresso nell'email: disegnato come TABELLA HTML di celle bianche/nere invece che come
// immagine. Gmail & co. bloccano le immagini "data:" e spesso quelle remote: la tabella si vede
// sempre, anche senza allegati, e la fotocamera del terminale la legge dallo schermo del telefono.
// Encoder: vendor/qrcode.js (qrcode-generator, globale `qrcode`).

/** Matrice booleana del QR (true = modulo scuro). */
export function matriceQr(testo, qr = globalThis.qrcode) {
  if (typeof qr !== 'function') throw new Error('Generatore QR non caricato (vendor/qrcode.js)');
  const q = qr(0, 'M');
  q.addData(testo, 'Alphanumeric');
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/**
 * Tabella HTML del QR. Le celle consecutive dello stesso colore sono unite (colspan) per
 * restare ben sotto il limite di Gmail (~100 KB, oltre taglia il messaggio).
 * @param {boolean[][]} m  matrice da matriceQr()
 */
export function tabellaQrHtml(m, { modulo = 6, margine = 4 } = {}) {
  const n = m.length + 2 * margine;
  const riga = (r) => {
    const celle = [];
    for (let c = 0; c < n;) {
      const scuro = (x) => r >= margine && r < n - margine && x >= margine && x < n - margine && m[r - margine][x - margine];
      const v = scuro(c);
      let k = 1;
      while (c + k < n && scuro(c + k) === v) k++;
      const col = v ? '#000000' : '#ffffff';
      celle.push(`<td${k > 1 ? ` colspan="${k}"` : ''} width="${k * modulo}" height="${modulo}" bgcolor="${col}" style="width:${k * modulo}px;height:${modulo}px;background:${col};padding:0;font-size:0;line-height:0"></td>`);
      c += k;
    }
    return `<tr>${celle.join('')}</tr>`;
  };
  // una riga invisibile di celle singole fissa la larghezza delle colonne (serve ai colspan)
  const guida = `<tr>${Array.from({ length: n }, () => `<td width="${modulo}" style="width:${modulo}px;height:0;padding:0;font-size:0;line-height:0"></td>`).join('')}</tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" `
    + `style="border-collapse:collapse;table-layout:fixed;background:#ffffff;margin:0 auto;width:${n * modulo}px">`
    + guida + Array.from({ length: n }, (_, r) => riga(r)).join('') + '</table>';
}
