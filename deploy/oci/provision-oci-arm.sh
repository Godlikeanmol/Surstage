#!/usr/bin/env bash
set -euo pipefail

# Oracle Cloud Always Free ARM64 retry loop (2 OCPU / 12 GB — max free tier as of Aug 2026)
# Region: ap-mumbai-1
# Fill in your OCI OCIDs below before running:
COMPARTMENT_ID="${OCI_COMPARTMENT_ID:?Set OCI_COMPARTMENT_ID}"
SUBNET_ID="${OCI_SUBNET_ID:?Set OCI_SUBNET_ID}"
IMAGE_ID="${OCI_UBUNTU_ARM64_IMAGE_ID:?Set OCI_UBUNTU_ARM64_IMAGE_ID}"
SSH_PUB_KEY_FILE="${SSH_PUB_KEY_FILE:-$HOME/.ssh/id_ed25519.pub}"
AVAILABILITY_DOMAIN="${OCI_AD:-}" # Optional; auto-detected if empty

if [ -z "$AVAILABILITY_DOMAIN" ]; then
  AVAILABILITY_DOMAIN=$(oci iam availability-domain list \
    --compartment-id "$COMPARTMENT_ID" \
    --query "data[0].name" --raw-output)
fi

echo "Provisioning 2 OCPU / 12 GB VM.Standard.A1.Flex in $AVAILABILITY_DOMAIN (ap-mumbai-1)..."

attempt=1
while true; do
  echo "[$(date -u +%H:%M:%S)] Attempt #$attempt..."
  if oci compute instance launch \
    --compartment-id "$COMPARTMENT_ID" \
    --availability-domain "$AVAILABILITY_DOMAIN" \
    --display-name "surstage-karaoke-arm" \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config '{"ocpus":2,"memoryInGBs":12}' \
    --assign-public-ip true \
    --ssh-authorized-keys-file "$SSH_PUB_KEY_FILE" \
    --wait-for-state RUNNING; then
    echo "Instance provisioned successfully!"
    break
  fi
  echo "Capacity unavailable or transient error. Retrying in 60 seconds..."
  attempt=$((attempt + 1))
  sleep 60
done

# Run this on the Ubuntu ARM64 instance after SSHing in to open LiveKit & Caddy ports in iptables:
#   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
#   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
#   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 7881 -j ACCEPT
#   sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 3478 -j ACCEPT
#   sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 50000:60000 -j ACCEPT
#   sudo netfilter-persistent save
