#!/usr/bin/env bash
# Infra · preparazione UNA TANTUM della VM (Ubuntu, Oracle Cloud).
# Installa Nginx, Git, Certbot, rsync e apre le porte 80/443.
# Da eseguire una sola volta per VM.
#   bash deploy/host-init.sh            # base
#   bash deploy/host-init.sh --node     # installa anche Node.js 20 (per i backend)
set -euo pipefail
step(){ printf '\n\033[1;38;5;208m▸ %s\033[0m\n' "$1"; }

WITH_NODE=0
[ "${1:-}" = "--node" ] && WITH_NODE=1

step "Aggiorno il sistema"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

step "Installo Nginx, Git, Certbot, rsync"
sudo apt-get install -y nginx git curl rsync certbot python3-certbot-nginx

if [ "$WITH_NODE" = "1" ]; then
  step "Installo Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

step "Apro le porte 80 e 443 nel firewall del sistema"
open_port(){
  local port="$1"
  if ! sudo iptables -C INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
    echo "  porta $port aperta"
  else echo "  porta $port già aperta"; fi
}
if command -v iptables >/dev/null 2>&1; then
  open_port 80; open_port 443
  sudo netfilter-persistent save 2>/dev/null \
    || sudo bash -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true
fi

sudo mkdir -p /opt/sites /var/www
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl enable --now nginx >/dev/null 2>&1 || true

step "VM pronta ✔"
echo "  Ricorda: apri 80/443 anche nella Security List della VCN (console OCI)."
echo "  Ora pubblica i progetti con:"
echo "    sudo bash deploy/site.sh <nome> <sottodominio> --repo <giturl>"
