#!/usr/bin/env bash
# Infra · pubblica/aggiorna UN progetto sulla VM (vhost Nginx per sottodominio).
# Riusabile per qualsiasi repo con una cartella statica (default: web/).
#
#   sudo bash deploy/site.sh gymin gymin.miodominio.it --repo https://github.com/loriscuba/GymIN.git
#   sudo bash deploy/site.sh sito2 sito2.miodominio.it --repo <url> --webdir public --branch main
#   sudo bash deploy/site.sh gymin gymin.miodominio.it --src /home/ubuntu/gymin   # repo già presente
set -euo pipefail
step(){ printf '\n\033[1;38;5;208m▸ %s\033[0m\n' "$1"; }
die(){ echo "✖ $1" >&2; exit 1; }

NAME="${1:-}"; SERVER_NAME="${2:-}"
[ -n "$NAME" ] && [ -n "$SERVER_NAME" ] \
  || die "Uso: site.sh <nome> <sottodominio> [--repo <url> | --src <dir>] [--webdir web] [--branch main]"
# nome ammesso: lettere, numeri, trattino/underscore
[[ "$NAME" =~ ^[a-zA-Z0-9_-]+$ ]] || die "Nome progetto non valido: $NAME"
shift 2

REPO=""; SRC=""; WEBDIR="web"; BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)   REPO="$2";   shift 2;;
    --src)    SRC="$2";    shift 2;;
    --webdir) WEBDIR="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    *) die "Opzione sconosciuta: $1";;
  esac
done

SITES_ROOT="/opt/sites"
if [ -z "$SRC" ]; then
  [ -n "$REPO" ] || die "Serve --repo <url> oppure --src <dir>"
  SRC="$SITES_ROOT/$NAME"
  if [ -d "$SRC/.git" ]; then
    step "Aggiorno il codice ($NAME)"
    sudo git -C "$SRC" pull --ff-only
  else
    step "Clono il repo ($NAME)"
    sudo mkdir -p "$SITES_ROOT"
    sudo git clone ${BRANCH:+-b "$BRANCH"} "$REPO" "$SRC"
  fi
fi

WEB_SRC="$SRC/$WEBDIR"
[ -d "$WEB_SRC" ] || die "Cartella '$WEBDIR/' non trovata in $SRC"

WEB_ROOT="/var/www/$NAME"
step "Pubblico in $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$WEB_SRC"/ "$WEB_ROOT"/ 2>/dev/null \
  || sudo cp -r "$WEB_SRC"/. "$WEB_ROOT"/

step "Configuro il vhost Nginx ($SERVER_NAME)"
sudo tee "/etc/nginx/sites-available/$NAME" >/dev/null <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;
    root $WEB_ROOT;
    index index.html;
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
sudo ln -sf "/etc/nginx/sites-available/$NAME" "/etc/nginx/sites-enabled/$NAME"
sudo nginx -t
sudo systemctl reload nginx

step "Pubblicato ✔"
echo "  $NAME → http://$SERVER_NAME"
echo "  HTTPS (dopo aver puntato il DNS):  sudo certbot --nginx -d $SERVER_NAME"
echo "  Aggiornare dopo un push:           sudo bash deploy/site-update.sh $NAME${WEBDIR:+ --webdir $WEBDIR}"
