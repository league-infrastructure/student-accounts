#!/usr/bin/env bash
set -euo pipefail

# setup-server.sh — Configure a freshly-provisioned Docker droplet.
#
# This script SSHes into the droplet and:
#   1. Creates the "caddy" Docker network
#   2. Copies the Caddy docker-compose stack and starts it
#   3. Verifies Caddy is running with test services (whoami, hello)
#
# Usage:
#   ./digital-ocean/setup-server.sh <number>       e.g. ./digital-ocean/setup-server.sh 2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

: "${CADDY_ACME_EMAIL:?Set CADDY_ACME_EMAIL in config.env}"

NUMBER="${1:-}"

if [[ -z "$NUMBER" ]]; then
  echo "Usage: $0 <number>"
  echo ""
  echo "  Sets up ${DROPLET_NAME_PREFIX}<number> with Docker networking and Caddy"
  echo "  Example: $0 2"
  exit 1
fi

if ! [[ "$NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Argument must be a number, got '$NUMBER'"
  exit 1
fi

require_do_token
lookup_droplet_ip "$NUMBER"

SSH_TARGET="root@$DROPLET_IP"

echo "==> Connecting to $DROPLET_NAME ($SSH_TARGET)"

# Test SSH connectivity
if ! ssh $SSH_OPTS "$SSH_TARGET" "echo ok" >/dev/null 2>&1; then
  echo "ERROR: Cannot SSH to $SSH_TARGET"
  echo "       The droplet may still be booting. Wait a minute and retry."
  exit 1
fi

echo "==> Setting up Docker network and Caddy on $DROPLET_NAME ($DROPLET_IP)"

# Step 1: Create the caddy network (if it doesn't exist)
ssh $SSH_OPTS "$SSH_TARGET" bash -s <<'REMOTE_NETWORK'
set -euo pipefail

if ! docker network inspect caddy >/dev/null 2>&1; then
  echo "  Creating Docker network: caddy"
  docker network create caddy
else
  echo "  Docker network 'caddy' already exists"
fi
REMOTE_NETWORK

# Step 2: Copy the caddy compose file to the server
echo "==> Copying Caddy compose stack"
scp $SSH_OPTS "$SCRIPT_DIR/caddy-compose.yml" "$SSH_TARGET:/opt/caddy-compose.yml"

# Step 3: Start the Caddy stack with the correct apps domain
APPS_DOMAIN="apps${NUMBER}.${R53_DOMAIN_BASE}"
echo "==> Starting Caddy stack (APPS_DOMAIN=$APPS_DOMAIN)"
ssh $SSH_OPTS "$SSH_TARGET" bash -s -- "$APPS_DOMAIN" <<'REMOTE_CADDY'
set -euo pipefail

APPS_DOMAIN="$1"
cd /opt
APPS_DOMAIN="$APPS_DOMAIN" docker compose -f caddy-compose.yml up -d

echo ""
echo "  Caddy containers:"
docker compose -f caddy-compose.yml ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
REMOTE_CADDY

echo ""
echo "==> Server setup complete: $DROPLET_NAME ($DROPLET_IP)"
echo ""
echo "Caddy is running with caddy-docker-proxy."
echo ""
echo "To deploy an app, its docker-compose services need:"
echo "  1. Join the 'caddy' network (networks: caddy: external: true)"
echo "  2. Add Caddy labels:"
echo "       labels:"
echo "         caddy: myapp.apps${NUMBER}.${R53_DOMAIN_BASE}"
echo '         caddy.reverse_proxy: "{{upstreams 3000}}"'
echo ""
echo "Docker context setup:"
echo "  docker context create $DROPLET_NAME --docker 'host=ssh://root@$DROPLET_IP'"
echo ""
