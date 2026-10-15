// Scadenza licenza.
// La data/ora di scadenza la imposta l'amministratore da Impostazioni (app_impostazioni,
// chiave licenza) e app.js la passa qui con window.gyminLicenza(email, scadenza).
// Dalla scadenza blocca l'app con un popup non chiudibile, solo per l'utente LICENZA_UTENTE,
// finché non viene inserita la chiave. Una nuova scadenza annulla lo sblocco precedente.
// La chiave non è nel codice: si confronta solo il suo hash SHA-256.
(function () {
  var LICENZA_UTENTE = 'admin@gymin.local';
  var KEY_HASH = '64e9688148dd4571f4fb46d64b7b80091f04b698e9fb2838ae0921de3610059f';
  var STORAGE_KEY = 'gymin_licenza';
  var stato = { email: '', scadenza: null };
  var onSblocco = null;   // avviso a chi gestisce la licenza (app.js manda una email)
  var ov = null;

  function sbloccoCorrente() { return KEY_HASH + '|' + stato.scadenza; }
  function sbloccata() {
    try { return localStorage.getItem(STORAGE_KEY) === sbloccoCorrente(); } catch (e) { return false; }
  }
  function bloccare() {
    if (stato.email !== LICENZA_UTENTE || !stato.scadenza) return false;
    var t = new Date(stato.scadenza).getTime();
    return !isNaN(t) && Date.now() >= t && !sbloccata();
  }

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  // impedisce di chiudere il popup con Esc
  function blocca(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); } }

  function mostra() {
    ov = document.createElement('div');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.85);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif';
    ov.innerHTML =
      '<form style="background:#fff;color:#111;max-width:380px;width:100%;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.4)">' +
      '<h2 style="margin:0 0 8px;font-size:20px">Licenza DB + Web scaduta</h2>' +
      '<p style="margin:0 0 16px;font-size:14px;color:#444">La licenza DB + Web è scaduta. Inserisci la chiave di licenza per continuare.</p>' +
      '<input type="password" autocomplete="off" placeholder="Chiave di licenza" required style="width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px">' +
      '<div class="lic-err" style="color:#b91c1c;font-size:13px;min-height:18px;margin:6px 0"></div>' +
      '<button type="submit" style="width:100%;padding:10px;font-size:15px;font-weight:600;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">Attiva</button>' +
      '</form>';
    var input = ov.querySelector('input');
    var err = ov.querySelector('.lic-err');
    ov.querySelector('form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      sha256(input.value).then(function (h) {
        if (h !== KEY_HASH) { err.textContent = 'Chiave non valida.'; input.select(); return; }
        try { localStorage.setItem(STORAGE_KEY, sbloccoCorrente()); } catch (e) {}
        nascondi();
        if (onSblocco) { try { onSblocco(stato.email, stato.scadenza); } catch (e) {} }
      });
    });
    document.addEventListener('keydown', blocca, true);
    document.body.appendChild(ov);
    input.focus();
  }
  function nascondi() {
    if (!ov) return;
    ov.remove();
    ov = null;
    document.removeEventListener('keydown', blocca, true);
  }

  function controlla() {
    if (bloccare()) { if (!ov) mostra(); else if (!document.body.contains(ov)) document.body.appendChild(ov); }
    else nascondi();
  }

  window.gyminLicenza = function (email, scadenza, avviso) {
    if (avviso) onSblocco = avviso;
    stato = { email: (email || '').toLowerCase(), scadenza: scadenza || null };
    controlla();
  };
  // se qualcuno rimuove il popup dal DOM, lo rimette
  new MutationObserver(function () { if (ov && !document.body.contains(ov)) controlla(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  // l'app può restare aperta per giorni: ricontrolla l'ora ogni 15 secondi
  setInterval(controlla, 15000);
})();
