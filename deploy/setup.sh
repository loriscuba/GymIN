#!/usr/bin/env bash
# GymIN · scorciatoia: prepara la VM E pubblica GymIN in un colpo solo.
# Sotto usa gli script riusabili host-init.sh + site.sh.
#   bash deploy/setup.sh
#   SERVER_NAME=gymin.miodominio.it bash deploy/setup.sh   # usa un dominio
#   INSTALL_NODE=1 bash deploy/setup.sh                    # installa anche Node.js (per il mailer)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# server_name: dominio passato via env, altrimenti IP pubblico, altrimenti "_"
SERVER_NAME="${SERVER_NAME:-$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo _)}"
NODE_FLAG=""
[ "${INSTALL_NODE:-0}" = "1" ] && NODE_FLAG="--node"

bash "$SCRIPT_DIR/host-init.sh" $NODE_FLAG
sudo bash "$SCRIPT_DIR/site.sh" gymin "$SERVER_NAME" --src "$REPO_DIR"
