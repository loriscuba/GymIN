#!/usr/bin/env bash
# Infra · crea la VM ARM Always Free riprovando finché c'è capacità.
#
# DOVE: nella OCI Cloud Shell (icona ">_" in alto a destra nella console OCI) —
#       lì l'OCI CLI è già autenticata, non devi configurare niente.
#
# USO:
#   bash deploy/oci-launch-retry.sh
#   OCPUS=2 MEMORY_GB=12 SLEEP_SECONDS=90 DISPLAY_NAME=hub bash deploy/oci-launch-retry.sh
#
# Trova da solo compartment, AD, subnet e immagine Ubuntu 22.04 ARM.
# Se hai più subnet e ne prende una sbagliata, passala con:  SUBNET=ocid1.subnet... bash ...
set -euo pipefail

DISPLAY_NAME="${DISPLAY_NAME:-gymin-vm}"
OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
BOOT_GB="${BOOT_GB:-50}"
SLEEP_SECONDS="${SLEEP_SECONDS:-180}"   # non scendere sotto ~120s: Oracle limita i tentativi (errore 429)
SHAPE="VM.Standard.A1.Flex"

command -v oci >/dev/null || { echo "✖ OCI CLI non trovata. Apri la Cloud Shell dalla console OCI (icona >_)."; exit 1; }

# chiave SSH: usa/crea una RSA (la Cloud Shell OCI è in FIPS mode: niente ed25519)
SSH_PUB="${SSH_PUB:-$HOME/.ssh/id_rsa.pub}"
if [ ! -f "$SSH_PUB" ]; then
  echo "▸ Genero una chiave SSH RSA: $SSH_PUB"
  ssh-keygen -t rsa -b 4096 -N "" -f "${SSH_PUB%.pub}" >/dev/null
fi

echo "▸ Scopro gli identificativi (compartment, AD, subnet, immagine)…"
COMPARTMENT="${COMPARTMENT:-$(oci iam availability-domain list --query 'data[0]."compartment-id"' --raw-output)}"
AD="${AD:-$(oci iam availability-domain list --compartment-id "$COMPARTMENT" --query 'data[0].name' --raw-output)}"
SUBNET="${SUBNET:-$(oci network subnet list -c "$COMPARTMENT" --query 'data[0].id' --raw-output 2>/dev/null || true)}"
[ -n "${SUBNET:-}" ] && [ "$SUBNET" != "null" ] || { echo "✖ Nessuna subnet trovata: crea prima la VCN con la procedura guidata."; exit 1; }
IMAGE="${IMAGE:-$(oci compute image list -c "$COMPARTMENT" \
  --operating-system 'Canonical Ubuntu' --operating-system-version '22.04' \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)}"

cat <<INFO
  Nome VM:   $DISPLAY_NAME
  Risorse:   $OCPUS OCPU / ${MEMORY_GB} GB  (shape $SHAPE, boot ${BOOT_GB} GB)
  AD:        $AD
  Subnet:    $SUBNET
  Immagine:  $IMAGE
  Riprovo ogni ${SLEEP_SECONDS}s finché c'è capacità.  (Ctrl+C per fermare)
INFO

n=0
while true; do
  n=$((n + 1))
  printf '[%s] tentativo #%s… ' "$(date '+%H:%M:%S')" "$n"
  if OUT="$(oci compute instance launch \
      --compartment-id "$COMPARTMENT" \
      --availability-domain "$AD" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
      --image-id "$IMAGE" \
      --subnet-id "$SUBNET" \
      --assign-public-ip true \
      --boot-volume-size-in-gbs "$BOOT_GB" \
      --display-name "$DISPLAY_NAME" \
      --metadata "{\"ssh_authorized_keys\":\"$(cat "$SSH_PUB")\"}" \
      --wait-for-state RUNNING 2>&1)"; then
    echo "OK ✔"
    INST_ID="$(printf '%s' "$OUT" | grep -oE 'ocid1\.instance\.[a-z0-9._-]+' | head -1)"
    IP="$(oci compute instance list-vnics --instance-id "$INST_ID" --query 'data[0]."public-ip"' --raw-output 2>/dev/null || true)"
    echo
    echo "✔ VM '$DISPLAY_NAME' creata e in esecuzione."
    if [ -n "${IP:-}" ] && [ "$IP" != "null" ]; then
      echo "  IP pubblico: $IP"
      echo "  Connettiti:  ssh -i ${SSH_PUB%.pub} ubuntu@$IP"
    fi
    echo "  Poi apri 80/443 nella Security List e lancia:  bash deploy/host-init.sh"
    break
  else
    if printf '%s' "$OUT" | grep -qiE 'Out of host capacity|capacit'; then
      echo "capacità esaurita, riprovo tra ${SLEEP_SECONDS}s"
      sleep "$SLEEP_SECONDS"
    elif printf '%s' "$OUT" | grep -qiE 'TooManyRequests|Too many requests|"status": *429'; then
      echo "throttling di Oracle (429): rallento, riprovo tra $((SLEEP_SECONDS * 2))s"
      sleep "$((SLEEP_SECONDS * 2))"
    else
      echo "ERRORE (non di capacità):"
      printf '%s\n' "$OUT"
      exit 1
    fi
  fi
done
