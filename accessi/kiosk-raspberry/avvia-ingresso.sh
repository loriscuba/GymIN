#!/usr/bin/env bash
# ======================================================================
#  GymIN - Terminale ingresso su Raspberry Pi: Chromium in modalità kiosk
#  Gemello di kiosk/avvia-ingresso.bat (Windows):
#  - profilo Chromium DEDICATO (service worker, cache e coda offline
#    restano sul Raspberry anche dopo il riavvio)
#  - audio senza click (--autoplay-policy=no-user-gesture-required)
#  - se Chromium si chiude o va in crash viene riaperto dopo 5 secondi
#  Per fermarlo: ferma-ingresso.sh
# ======================================================================

# ---- CONFIGURAZIONE --------------------------------------------------
# Indirizzo della pagina /ingresso (produzione)
URL_INGRESSO="${URL_INGRESSO:-https://loriscuba.github.io/GymIN/accessi/ingresso/}"
# Cartella del profilo Chromium dedicato al terminale
BASE="${BASE:-$HOME/.local/share/GymIN-Ingresso}"
PROFILO="$BASE/chromium-profilo"
# ---------------------------------------------------------------------

STOP="$BASE/STOP"

CHROMIUM="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$CHROMIUM" ]; then
  echo "Chromium non trovato. Installalo con: sudo apt install chromium-browser" >&2
  exit 1
fi

mkdir -p "$PROFILO"
rm -f "$STOP"

# errore 0 se il Chromium del kiosk (profilo GymIN-Ingresso) è in esecuzione
in_esecuzione() { pgrep -u "$(id -u)" -f -- "--user-data-dir=$PROFILO" >/dev/null; }

# già in esecuzione (doppio avvio)? non aprire un secondo kiosk
if in_esecuzione; then
  echo "Il terminale è già avviato."
  exit 0
fi

# attesa breve all'accensione: lascia partire rete, desktop e audio HDMI
sleep "${ATTESA_AVVIO_S:-10}"

# X11: niente screen saver né spegnimento dello schermo (con Wayland ci pensa raspi-config)
if [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null; then
  xset s off -dpms s noblank 2>/dev/null || true
fi

while [ ! -f "$STOP" ]; do
  # dopo un crash Chromium chiede "Ripristina pagine?": segna l'uscita come pulita
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' \
    "$PROFILO/Default/Preferences" 2>/dev/null || true

  "$CHROMIUM" \
    --user-data-dir="$PROFILO" \
    --kiosk "$URL_INGRESSO" \
    --autoplay-policy=no-user-gesture-required \
    --password-store=basic \
    --ozone-platform-hint=auto \
    --no-first-run \
    --no-default-browser-check \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --hide-crash-restore-bubble \
    --disable-features=Translate,TranslateUI \
    --overscroll-history-navigation=0 \
    --disable-pinch \
    --check-for-update-interval=31536000 >/dev/null 2>&1

  # Chromium a volte "passa la mano" a un processo già aperto e ritorna subito:
  # finché il Chromium del kiosk è vivo non lo si riapre
  while sleep 5; do
    [ -f "$STOP" ] && break 2
    in_esecuzione || break
  done
done

rm -f "$STOP"
