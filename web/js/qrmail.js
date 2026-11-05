// QR d'ingresso nell'email: disegnato come TABELLA HTML di celle bianche/nere invece che come
// immagine. Gmail & co. bloccano le immagini "data:" e spesso quelle remote: la tabella si vede
// sempre, anche senza allegati, e la fotocamera del terminale la legge dallo schermo del telefono.
// Encoder: vendor/qrcode.js (qrcode-generator, globale `qrcode`).

/**
 * Matrice booleana del QR (true = modulo scuro). Correzione d'errore H (30%): regge il logo
 * al centro. Versione automatica (29×29 per i codici 'QR' + 32): una più grande supera i 100 KB di Gmail.
 */
export function matriceQr(testo, qr = globalThis.qrcode) {
  if (typeof qr !== 'function') throw new Error('Generatore QR non caricato (vendor/qrcode.js)');
  const q = qr(0, 'H');
  q.addData(testo, 'Alphanumeric');
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** Lato (in moduli, dispari) del quadrato bianco centrale per il logo: ~30% del lato, < 10% dell'area. */
export const latoLogo = (n) => { const k = Math.round(n * 0.3); return k % 2 ? k : k - 1; };

/**
 * Tabella HTML del QR. Le celle consecutive dello stesso colore sono unite (colspan) per
 * restare ben sotto il limite di Gmail (~100 KB, oltre taglia il messaggio).
 * Con `logo` (URL assoluto di un'immagine) il centro diventa una cella bianca con il logo:
 * se il programma di posta blocca l'immagine resta bianca e il QR si legge lo stesso.
 * @param {boolean[][]} m  matrice da matriceQr()
 */
export function tabellaQrHtml(m, { modulo = 6, margine = 4, logo = null } = {}) {
  const n = m.length + 2 * margine;
  const k = logo ? latoLogo(m.length) : 0;
  const z0 = margine + (m.length - k) / 2, z1 = z0 + k;   // area del logo [z0, z1) in righe e colonne
  const inZona = (r, c) => r >= z0 && r < z1 && c >= z0 && c < z1;
  const riga = (r) => {
    const celle = [];
    for (let c = 0; c < n;) {
      if (inZona(r, c)) {
        if (r === z0) {
          const lato = k * modulo, img = lato - modulo;
          celle.push(`<td rowspan="${k}" colspan="${k}" width="${lato}" height="${lato}" align="center" valign="middle" bgcolor="#ffffff" style="width:${lato}px;height:${lato}px;background:#ffffff;padding:0;line-height:0">`
            + `<img src="${logo}" width="${img}" height="${img}" alt="" style="display:block;margin:0 auto;width:${img}px;height:${img}px;border:0;object-fit:contain"></td>`);
        }
        c += k;
        continue;
      }
      const scuro = (x) => r >= margine && r < n - margine && x >= margine && x < n - margine && m[r - margine][x - margine];
      const v = scuro(c);
      let j = 1;
      while (c + j < n && !inZona(r, c + j) && scuro(c + j) === v) j++;
      // le celle bianche prendono lo sfondo bianco della tabella: niente colore, meno byte
      const col = v ? ' bgcolor="#000000"' : '', bg = v ? 'background:#000000;' : '';
      celle.push(`<td${j > 1 ? ` colspan="${j}"` : ''} width="${j * modulo}" height="${modulo}"${col} style="width:${j * modulo}px;height:${modulo}px;${bg}padding:0;font-size:0;line-height:0"></td>`);
      c += j;
    }
    return `<tr>${celle.join('')}</tr>`;
  };
  // una riga invisibile di celle singole fissa la larghezza delle colonne (serve ai colspan)
  const guida = `<tr>${Array.from({ length: n }, () => `<td width="${modulo}" style="width:${modulo}px;height:0;padding:0;font-size:0;line-height:0"></td>`).join('')}</tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" `
    + `style="border-collapse:collapse;table-layout:fixed;background:#ffffff;margin:0 auto;width:${n * modulo}px">`
    + guida + Array.from({ length: n }, (_, r) => riga(r)).join('') + '</table>';
}
