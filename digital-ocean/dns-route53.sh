#!/usr/bin/env bash
set -euo pipefail

# dns-route53.sh — Generate AWS CLI commands for Route 53 wildcard DNS.
#
# Looks up the droplet IP from DigitalOcean, then outputs commands you
# can paste into AWS CloudShell to create/update a wildcard A record:
#   *.appsN.jointheleague.org → <droplet-ip>
#
# Usage:
#   ./digital-ocean/dns-route53.sh <number>
#
# Examples:
#   ./digital-ocean/dns-route53.sh 2   → *.apps2.jointheleague.org → docker2's IP

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

: "${R53_HOSTED_ZONE_ID:?Set R53_HOSTED_ZONE_ID in config.env (Route 53 hosted zone for jointheleague.org)}"

NUMBER="${1:-}"

if [[ -z "$NUMBER" ]]; then
  echo "Usage: $0 <number>"
  echo ""
  echo "  Looks up ${DROPLET_NAME_PREFIX}<number> and generates Route 53 commands"
  echo "  for *.apps<number>.${R53_DOMAIN_BASE}"
  echo "  Example: $0 2"
  exit 1
fi

if ! [[ "$NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Argument must be a number, got '$NUMBER'"
  exit 1
fi

require_do_token
lookup_droplet_ip "$NUMBER"

WILDCARD_DOMAIN="*.apps${NUMBER}.${R53_DOMAIN_BASE}"

echo "==> Found $DROPLET_NAME at $DROPLET_IP" >&2
echo "" >&2

cat <<EOF
# ---------------------------------------------------------------
# Route 53: ${WILDCARD_DOMAIN} → ${DROPLET_IP}
#
# Paste the following into AWS CloudShell.
# This creates (or updates) a wildcard A record.
# ---------------------------------------------------------------

aws route53 change-resource-record-sets \\
  --hosted-zone-id ${R53_HOSTED_ZONE_ID} \\
  --change-batch '{
    "Changes": [
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "${WILDCARD_DOMAIN}",
          "Type": "A",
          "TTL": 300,
          "ResourceRecords": [
            { "Value": "${DROPLET_IP}" }
          ]
        }
      }
    ]
  }'

# ---------------------------------------------------------------
# To verify (after a minute or two):
#   dig +short anything.apps${NUMBER}.${R53_DOMAIN_BASE}
#   # should return: ${DROPLET_IP}
# ---------------------------------------------------------------
EOF
