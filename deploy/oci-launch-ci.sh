#!/usr/bin/env bash
# Infra · UN tentativo di creare la VM ARM (per GitHub Actions, non interattivo).
# Se la VM esiste già non fa nulla; se manca capacità esce pulito (riproverà al
# prossimo giro schedulato); se la crea, stampa l'OCID.
set -euo pipefail

DISPLAY_NAME="${DISPLAY_NAME:-gymin-vm}"
OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
BOOT_GB="${BOOT_GB:-50}"
SHAPE="VM.Standard.A1.Flex"
: "${SSH_PUBKEY:?Serve la variabile SSH_PUBKEY (chiave pubblica RSA)}"

COMPARTMENT="${OCI_COMPARTMENT:-$(oci iam availability-domain list --query 'data[0]."compartment-id"' --raw-output)}"

# guardia anti-doppioni: se una VM con questo nome è già viva, esci
EXIST="$(oci compute instance list -c "$COMPARTMENT" --display-name "$DISPLAY_NAME" \
  --query 'length(data[?"lifecycle-state"==`RUNNING` || "lifecycle-state"==`PROVISIONING` || "lifecycle-state"==`STARTING`])' \
  --raw-output 2>/dev/null || echo 0)"
if [ "${EXIST:-0}" != "0" ]; then
  echo "✔ La VM '$DISPLAY_NAME' esiste già: niente da fare. Puoi disattivare il workflow."
  exit 0
fi

AD="${OCI_AD:-$(oci iam availability-domain list --compartment-id "$COMPARTMENT" --query 'data[0].name' --raw-output)}"
SUBNET="${OCI_SUBNET:-$(oci network subnet list -c "$COMPARTMENT" --query 'data[0].id' --raw-output)}"
IMAGE="${OCI_IMAGE:-$(oci compute image list -c "$COMPARTMENT" \
  --operating-system 'Canonical Ubuntu' --operating-system-version '22.04' \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)}"

echo "Tentativo: $DISPLAY_NAME · $OCPUS OCPU / ${MEMORY_GB} GB · AD $AD"
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
    --metadata "{\"ssh_authorized_keys\":\"$SSH_PUBKEY\"}" 2>&1)"; then
  echo "✔ VM creata!"
  printf '%s\n' "$OUT" | grep -oE 'ocid1\.instance\.[a-z0-9._-]+' | head -1
  echo "Ora puoi disattivare il workflow (Actions → OCI launch → ⋯ → Disable)."
  exit 0
else
  if printf '%s' "$OUT" | grep -qiE 'Out of host capacity|capacit'; then
    echo "Capacità esaurita: riproverà al prossimo giro."
    exit 0
  fi
  if printf '%s' "$OUT" | grep -qiE 'TooManyRequests|Too many requests|"status": *429'; then
    echo "Throttling di Oracle (429): riproverà al prossimo giro."
    exit 0
  fi
  echo "✖ Errore (non di capacità):"
  printf '%s\n' "$OUT"
  exit 1
fi
