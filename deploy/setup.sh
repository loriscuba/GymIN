#!/usr/bin/env bash
# GymIN · setup automatico su Ubuntu (Oracle Cloud Always Free)
# Installa Nginx, apre le porte 80/443 e pubblica il frontend (web/).
#
# Uso (dopo aver clonato il repo sulla VM):
#   bash deploy/setup.sh
#   SERVER_NAME=gymin.miodominio.it bash deploy/setup.sh   # usa un dominio
#   INSTALL_NODE=1 bash deploy/setup.sh                    # installa anche Node.js (per il mailer)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
WEB_SRC="$REPO_DIR/web"
WEB_ROOT="/var/www/gymin"

step(){ printf '\n\033[1;38;5;208m▸ %s\033[0m\n' "$1"; }

[ -d "$WEB_SRC" ] || { echo "✖ Cartella web/ non trovata in $REPO_DIR — esegui lo script dentro il repo clonato."; exit 1; }

# server_name: dominio passato via env, altrimenti IP pubblico, altrimenti "_"
SERVER_NAME="${SERVER_NAME:-$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo _)}"

step "Aggiorno il sistema e installo Nginx + Git"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo apt-get install -y nginx git curl

if [ "${INSTALL_NODE:-0}" = "1" ]; then
  step "Installo Node.js 20 (per il modulo mail)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

step "Apro le porte 80 e 443 nel firewall del sistema"
open_port(){
  local port="$1"
  if ! sudo iptables -C INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
    echo "  porta $port aperta"
  else
    echo "  porta $port già aperta"
  fi
}
if command -v iptables >/dev/null 2>&1; then
  open_port 80
  open_port 443
  sudo netfilter-persistent save 2>/dev/null \
    || sudo bash -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null \
    || echo "  (nota: salva tu le regole iptables se necessario)"
fi
echo "  Ricorda: apri 80/443 ANCHE nella Security List della VCN, dalla console OCI."

step "Pubblico il frontend in $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo cp -r "$WEB_SRC"/. "$WEB_ROOT"/

step "Configuro Nginx (server_name: $SERVER_NAME)"
sudo tee /etc/nginx/sites-available/gymin >/dev/null <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;
    root $WEB_ROOT;
    index index.html;
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/gymin /etc/nginx/sites-enabled/gymin
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

step "Fatto ✔"
echo "  GymIN è online:        http://$SERVER_NAME"
echo "  HTTPS (con dominio):   sudo apt -y install certbot python3-certbot-nginx && sudo certbot --nginx -d $SERVER_NAME"
echo "  Aggiornare dopo push:  bash deploy/update.sh"
