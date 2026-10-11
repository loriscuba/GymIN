#!/usr/bin/env bash
# ======================================================================
#  GymIN - installa il terminale ingresso su Raspberry Pi OS (desktop)
#  Va lanciato dall'utente che resterà collegato all'ingresso (NON root):
#      bash installa.sh             installa e attiva l'avvio automatico
#      bash installa.sh --rimuovi   toglie l'avvio automatico
#  Cosa fa (le parti con sudo chiedono la password una volta):
#  - installa Chromium se manca
#  - copia gli script in ~/GymIN-Ingresso e mette "GymIN Ingresso" in avvio automatico
#  - accesso automatico al desktop, schermo sempre acceso, fuso orario Roma
#  - pre-autorizza la pagina a parlare con il relè Shelly in LAN
# ======================================================================
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Lancia lo script come utente normale (es. 'ingresso'), non con sudo." >&2
  exit 1
fi

DEST="$HOME/GymIN-Ingresso"
AUTOSTART="$HOME/.config/autostart/gymin-ingresso.desktop"
ORIGINE_SITO="https://loriscuba.github.io"
QUI="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--rimuovi" ]; then
  rm -f "$AUTOSTART"
  bash "$DEST/ferma-ingresso.sh" 2>/dev/null || true
  echo "Avvio automatico rimosso. Gli script restano in $DEST."
  exit 0
fi

echo "1/5  Chromium"
if ! command -v chromium-browser >/dev/null && ! command -v chromium >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
fi

echo "2/5  Script in $DEST"
mkdir -p "$DEST"
install -m 755 "$QUI/avvia-ingresso.sh" "$QUI/ferma-ingresso.sh" "$DEST/"

echo "3/5  Avvio automatico (+ collegamenti sul Desktop)"
mkdir -p "$(dirname "$AUTOSTART")"
cat > "$AUTOSTART" <<DESKTOP
[Desktop Entry]
Type=Application
Name=GymIN Ingresso
Exec=$DEST/avvia-ingresso.sh
X-GNOME-Autostart-enabled=true
DESKTOP
if [ -d "$HOME/Desktop" ]; then
  cp "$AUTOSTART" "$HOME/Desktop/gymin-ingresso.desktop"
  sed "s#^Name=.*#Name=Ferma GymIN Ingresso#; s#^Exec=.*#Exec=$DEST/ferma-ingresso.sh#" \
    "$AUTOSTART" > "$HOME/Desktop/ferma-gymin-ingresso.desktop"
  chmod +x "$HOME/Desktop/"*gymin-ingresso.desktop
fi

echo "4/5  Accesso automatico, schermo sempre acceso, fuso orario"
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B4 || true   # desktop con accesso automatico
  sudo raspi-config nonint do_blanking 1 || true          # 1 = spegnimento schermo DISATTIVATO
fi
sudo timedatectl set-timezone Europe/Rome
sudo timedatectl set-ntp true || true

echo "5/5  Permesso 'Accesso alla rete locale' per il relè Shelly"
POLICY='{ "LocalNetworkAccessAllowedForUrls": ["'"$ORIGINE_SITO"'"] }'
for dir in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  sudo mkdir -p "$dir"
  echo "$POLICY" | sudo tee "$dir/gymin-ingresso.json" >/dev/null
done

echo
echo "Fatto. Riavvia il Raspberry (sudo reboot): il terminale si apre da solo dopo ~10 secondi."
echo "Alla PRIMA apertura serve internet: incolla il token del terminale e attendi 'Online'."
