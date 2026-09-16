#!/usr/bin/env bash
# GymIN · aggiorna la VM dopo un push su GitHub.
#   bash deploy/update.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
WEB_ROOT="/var/www/gymin"

cd "$REPO_DIR"
git pull --ff-only
sudo cp -r web/. "$WEB_ROOT"/
sudo systemctl reload nginx
echo "✔ GymIN aggiornato e Nginx ricaricato."
