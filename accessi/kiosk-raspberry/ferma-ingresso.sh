#!/usr/bin/env bash
# GymIN - chiude il kiosk dell'ingresso e impedisce che si riapra.
# Per ripartire: avvia-ingresso.sh oppure riavvia il Raspberry.
BASE="${BASE:-$HOME/.local/share/GymIN-Ingresso}"
mkdir -p "$BASE"
touch "$BASE/STOP"
pkill -u "$(id -u)" -f -- "--user-data-dir=$BASE/chromium-profilo" || true
echo "Terminale ingresso fermato."
