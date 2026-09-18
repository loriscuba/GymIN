#!/usr/bin/env bash
# Infra · UN SOLO comando per un tenant Oracle nuovo (es. Amsterdam).
# Crea TUTTA la rete da zero e poi la VM ARM Always Free, riprovando finché c'è capacità.
#
# DOVE LANCIARLO: nella OCI Cloud Shell (icona ">_" in alto a destra nella
#   console Oracle). Lì l'OCI CLI è già autenticata: non devi configurare niente.
#
# USO:
#   git clone https://github.com/loriscuba/gymin.git
#   bash gymin/deploy/oci-provision.sh
#
#   # opzioni (variabili d'ambiente):
#   OCPUS=2 MEMORY_GB=12 bash gymin/deploy/oci-provision.sh
#   VCN_NAME=demo-vcn DISPLAY_NAME=hub SLEEP_SECONDS=180 bash gymin/deploy/oci-provision.sh
#
# È idempotente: se la rete o la VM esistono già, non le ricrea.
set -euo pipefail

# ---- parametri -------------------------------------------------------------
VCN_NAME="${VCN_NAME:-demo-vcn}"
SUBNET_NAME="${SUBNET_NAME:-demo-subnet}"
VCN_CIDR="${VCN_CIDR:-10.0.0.0/16}"
SUBNET_CIDR="${SUBNET_CIDR:-10.0.1.0/24}"

DISPLAY_NAME="${DISPLAY_NAME:-gymin-vm}"
OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
BOOT_GB="${BOOT_GB:-50}"
SLEEP_SECONDS="${SLEEP_SECONDS:-180}"   # non scendere sotto ~120s: Oracle limita i tentativi (429)
SHAPE="VM.Standard.A1.Flex"

command -v oci >/dev/null || { echo "✖ OCI CLI non trovata. Apri la Cloud Shell dalla console OCI (icona >_)."; exit 1; }

# ---- chiave SSH (RSA: la Cloud Shell è in FIPS mode, niente ed25519) --------
SSH_PUB="${SSH_PUB:-$HOME/.ssh/id_rsa.pub}"
if [ ! -f "$SSH_PUB" ]; then
  echo "▸ Genero una chiave SSH RSA: $SSH_PUB"
  ssh-keygen -t rsa -b 4096 -N "" -f "${SSH_PUB%.pub}" >/dev/null
fi

# ---- compartment + availability domain -------------------------------------
COMPARTMENT="${COMPARTMENT:-$(oci iam availability-domain list --query 'data[0]."compartment-id"' --raw-output)}"
AD="${AD:-$(oci iam availability-domain list --compartment-id "$COMPARTMENT" --query 'data[0].name' --raw-output)}"
echo "▸ Compartment: $COMPARTMENT"
echo "▸ Availability domain: $AD"

# ===========================================================================
# 1) RETE — VCN, Internet Gateway, rotta di default, regole firewall, subnet
# ===========================================================================
echo
echo "== 1/2 · Rete =="

# --- VCN (riusa se esiste già col suo nome) ---------------------------------
VCN_ID="$(oci network vcn list -c "$COMPARTMENT" --display-name "$VCN_NAME" \
  --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [ -z "${VCN_ID:-}" ] || [ "$VCN_ID" = "null" ]; then
  echo "▸ Creo la VCN '$VCN_NAME' ($VCN_CIDR)…"
  VCN_ID="$(oci network vcn create -c "$COMPARTMENT" \
    --cidr-blocks "[\"$VCN_CIDR\"]" --display-name "$VCN_NAME" --dns-label demovcn \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
else
  echo "✔ VCN già presente: $VCN_ID"
fi

# route table e security list DI DEFAULT della VCN (le usiamo per la subnet)
RT_ID="$(oci network vcn get --vcn-id "$VCN_ID" --query 'data."default-route-table-id"' --raw-output)"
SL_ID="$(oci network vcn get --vcn-id "$VCN_ID" --query 'data."default-security-list-id"' --raw-output)"

# --- Internet Gateway (riusa se esiste) -------------------------------------
IG_ID="$(oci network internet-gateway list -c "$COMPARTMENT" --vcn-id "$VCN_ID" \
  --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [ -z "${IG_ID:-}" ] || [ "$IG_ID" = "null" ]; then
  echo "▸ Creo l'Internet Gateway…"
  IG_ID="$(oci network internet-gateway create -c "$COMPARTMENT" --vcn-id "$VCN_ID" \
    --is-enabled true --display-name demo-ig \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
else
  echo "✔ Internet Gateway già presente: $IG_ID"
fi

# --- Rotta di default 0.0.0.0/0 -> Internet Gateway -------------------------
echo "▸ Imposto la rotta di default verso Internet…"
oci network route-table update --rt-id "$RT_ID" --force \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IG_ID\"}]" \
  >/dev/null

# --- Regole firewall: apri 22 (SSH), 80 (HTTP), 443 (HTTPS) -----------------
echo "▸ Apro le porte 22, 80, 443 nella Security List…"
oci network security-list update --security-list-id "$SL_ID" --force \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' \
  --ingress-security-rules '[
    {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
    {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
    {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}
  ]' >/dev/null

# --- Subnet pubblica (riusa se esiste) --------------------------------------
SUBNET_ID="$(oci network subnet list -c "$COMPARTMENT" --vcn-id "$VCN_ID" --display-name "$SUBNET_NAME" \
  --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [ -z "${SUBNET_ID:-}" ] || [ "$SUBNET_ID" = "null" ]; then
  echo "▸ Creo la subnet pubblica '$SUBNET_NAME' ($SUBNET_CIDR)…"
  SUBNET_ID="$(oci network subnet create -c "$COMPARTMENT" --vcn-id "$VCN_ID" \
    --cidr-block "$SUBNET_CIDR" --display-name "$SUBNET_NAME" --dns-label demosub \
    --route-table-id "$RT_ID" --security-list-ids "[\"$SL_ID\"]" \
    --prohibit-public-ip-on-vnic false \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
else
  echo "✔ Subnet già presente: $SUBNET_ID"
fi

# ===========================================================================
# 2) VM — immagine Ubuntu 22.04 ARM + launch con retry finché c'è capacità
# ===========================================================================
echo
echo "== 2/2 · VM ARM =="

# guardia anti-doppioni: se una VM con questo nome è già viva, non ne crea un'altra
EXIST="$(oci compute instance list -c "$COMPARTMENT" --display-name "$DISPLAY_NAME" \
  --query 'length(data[?"lifecycle-state"==`RUNNING` || "lifecycle-state"==`PROVISIONING` || "lifecycle-state"==`STARTING`])' \
  --raw-output 2>/dev/null || echo 0)"
if [ "${EXIST:-0}" != "0" ]; then
  echo "✔ La VM '$DISPLAY_NAME' esiste già: niente da fare."
  IP="$(oci compute instance list-vnics --instance-id \
    "$(oci compute instance list -c "$COMPARTMENT" --display-name "$DISPLAY_NAME" --query 'data[0].id' --raw-output)" \
    --query 'data[0]."public-ip"' --raw-output 2>/dev/null || true)"
  [ -n "${IP:-}" ] && [ "$IP" != "null" ] && echo "  IP pubblico: $IP  →  ssh -i ${SSH_PUB%.pub} ubuntu@$IP"
  exit 0
fi

IMAGE="${IMAGE:-$(oci compute image list -c "$COMPARTMENT" \
  --operating-system 'Canonical Ubuntu' --operating-system-version '22.04' \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)}"

cat <<INFO
  Nome VM:   $DISPLAY_NAME
  Risorse:   $OCPUS OCPU / ${MEMORY_GB} GB  (shape $SHAPE, boot ${BOOT_GB} GB)
  AD:        $AD
  Subnet:    $SUBNET_ID
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
      --subnet-id "$SUBNET_ID" \
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
    echo "  Poi sulla VM:  git clone https://github.com/loriscuba/gymin.git ~/gymin && bash ~/gymin/deploy/host-init.sh"
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
