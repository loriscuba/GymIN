#!/usr/bin/env bash
# Backup cifrato del database Supabase (dump completo, compresso e cifrato AES-256).
# Complementa i backup automatici di Supabase: copia fuori dal fornitore, sotto il tuo controllo.
#
# Prerequisiti (una volta, sulla VM o sul PC che fa i backup):
#   sudo apt-get install -y postgresql-client gnupg      # pg_dump >= versione del server Supabase
#   install -m 600 /dev/null ~/.gymin-backup.env && nano ~/.gymin-backup.env
#     SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres   (Project Settings → Database)
#     BACKUP_PASSPHRASE_FILE=/home/ubuntu/.gymin-backup.pass                          (chmod 600, conservane una copia offline!)
#     BACKUP_DIR=/home/ubuntu/backup-gymin
#     BACKUP_GIORNI=30
#
# Uso:            bash deploy/backup-db.sh
# Pianificato:    crontab -e  →  30 3 * * * bash $HOME/gymin/deploy/backup-db.sh >> $HOME/backup-gymin.log 2>&1
# Ripristino:     gpg -d <file>.sql.gz.gpg | gunzip | psql "$DB_URL_DI_DESTINAZIONE"
#                 (provalo almeno una volta su un progetto di test e annota l'esito: è la prova che il backup funziona)
set -euo pipefail
umask 077

ENV_FILE="${GYMIN_BACKUP_ENV:-$HOME/.gymin-backup.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL mancante (vedi intestazione dello script)}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE mancante}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backup-gymin}"
BACKUP_GIORNI="${BACKUP_GIORNI:-30}"

[ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "Passphrase vuota o assente: $BACKUP_PASSPHRASE_FILE" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/gymin-$(date +%Y%m%d-%H%M%S).sql.gz.gpg"

# schemi applicativi + utenti staff (auth); niente dati interni di Supabase
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --schema=public --schema=test --schema=auth \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$BACKUP_PASSPHRASE_FILE" -o "$OUT"

[ -s "$OUT" ] || { echo "Backup vuoto: $OUT" >&2; exit 1; }
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"

# rotazione
find "$BACKUP_DIR" -name 'gymin-*.sql.gz.gpg' -mtime +"$BACKUP_GIORNI" -delete

# Copia fuori dalla VM (consigliata), es. OCI Object Storage (20 GB gratis) con l'OCI CLI:
#   oci os object put --bucket-name gymin-backup --file "$OUT" --force
