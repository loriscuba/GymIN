#!/usr/bin/env bash
# Infra · aggiorna UN progetto già pubblicato (git pull + ripubblica + reload).
#   sudo bash deploy/site-update.sh <nome> [--webdir web]
set -euo pipefail
NAME="${1:-}"
[ -n "$NAME" ] || { echo "Uso: site-update.sh <nome> [--webdir web]"; exit 1; }
WEBDIR="web"
[ "${2:-}" = "--webdir" ] && WEBDIR="${3:-web}"

SRC="/opt/sites/$NAME"
WEB_ROOT="/var/www/$NAME"
[ -d "$SRC/.git" ] || { echo "✖ $SRC non è un repo clonato: usa deploy/site.sh la prima volta."; exit 1; }

sudo git -C "$SRC" pull --ff-only
sudo rsync -a --delete "$SRC/$WEBDIR"/ "$WEB_ROOT"/ 2>/dev/null \
  || sudo cp -r "$SRC/$WEBDIR"/. "$WEB_ROOT"/
sudo systemctl reload nginx
echo "✔ $NAME aggiornato e Nginx ricaricato."
