// Simulazione scadenza licenza (solo ambiente di test).
// Dalla data SCADENZA (inclusa, ora locale del PC) blocca l'app con un popup non chiudibile
// finché non viene inserita la chiave. Prima di quella data l'app funziona normalmente.
// Per un nuovo periodo basta cambiare SCADENZA: lo sblocco precedente non vale più.
// La chiave non è nel codice: si confronta solo il suo hash SHA-256.
(function () {
  var cfg = window.GYMIN_CONFIG || {};
  if (cfg.ENV !== 'test') return;

  var KEY_HASH = '64e9688148dd4571f4fb46d64b7b80091f04b698e9fb2838ae0921de3610059f';
  var SCADENZA = '2026-10-26'; // AAAA-MM-GG: primo giorno di blocco
  var STORAGE_KEY = 'gymin_licenza_test';
  var SBLOCCO = KEY_HASH + '|' + SCADENZA;

  function sbloccata() {
    try { return localStorage.getItem(STORAGE_KEY) === SBLOCCO; } catch (e) { return false; }
  }
  function scaduta() {
    var p = SCADENZA.split('-');
    return new Date() >= new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  function mostra() {
    var ov = document.createElement('div');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.85);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif';
    ov.innerHTML =
      '<form style="background:#fff;color:#111;max-width:380px;width:100%;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.4)">' +
      '<h2 style="margin:0 0 8px;font-size:20px">Licenza scaduta</h2>' +
      '<p style="margin:0 0 16px;font-size:14px;color:#444">La licenza di GymIN è scaduta. Inserisci la chiave di licenza per continuare.</p>' +
      '<input type="password" autocomplete="off" placeholder="Chiave di licenza" required style="width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px">' +
      '<div class="lic-err" style="color:#b91c1c;font-size:13px;min-height:18px;margin:6px 0"></div>' +
      '<button type="submit" style="width:100%;padding:10px;font-size:15px;font-weight:600;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">Attiva</button>' +
      '</form>';
    var form = ov.querySelector('form');
    var input = ov.querySelector('input');
    var err = ov.querySelector('.lic-err');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      sha256(input.value).then(function (h) {
        if (h !== KEY_HASH) { err.textContent = 'Chiave non valida.'; input.select(); return; }
        try { localStorage.setItem(STORAGE_KEY, SBLOCCO); } catch (e) {}
        ov.remove();
        document.removeEventListener('keydown', blocca, true);
      });
    });
    // impedisce di chiudere il popup con Esc o di interagire con l'app sotto
    function blocca(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); } }
    document.addEventListener('keydown', blocca, true);
    document.body.appendChild(ov);
    input.focus();
    // se qualcuno rimuove il popup dal DOM, lo rimette
    new MutationObserver(function () {
      if (!sbloccata() && !document.body.contains(ov)) document.body.appendChild(ov);
    }).observe(document.body, { childList: true });
  }

  var mostrato = false;
  function controlla() {
    if (mostrato || sbloccata() || !scaduta()) return;
    mostrato = true;
    mostra();
  }
  if (document.body) controlla(); else document.addEventListener('DOMContentLoaded', controlla);
  // l'app può restare aperta per giorni: ricontrolla ogni minuto
  setInterval(controlla, 60000);
})();
