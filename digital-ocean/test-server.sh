#!/usr/bin/env bash
set -euo pipefail

# test-server.sh — Deploy a hello-world container and verify Caddy routing.
#
# Deploys crccheck/hello-world on the droplet with Caddy labels, waits
# for DNS + TLS to propagate, then curls the endpoint to confirm it works.
# Cleans up the test container when done.
#
# Usage:
#   ./digital-ocean/test-server.sh <number>
#
# Example:
#   ./digital-ocean/test-server.sh 2   → tests hello.apps2.jointheleague.org

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

NUMBER="${1:-}"

if [[ -z "$NUMBER" ]]; then
  echo "Usage: $0 <number>"
  echo ""
  echo "  Deploys a test container on ${DROPLET_NAME_PREFIX}<number>"
  echo "  and verifies https://hello.apps<number>.${R53_DOMAIN_BASE}"
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
TEST_DOMAIN="hello.apps${NUMBER}.${R53_DOMAIN_BASE}"

echo "==> Testing $DROPLET_NAME ($DROPLET_IP)"
echo "    Domain: $TEST_DOMAIN"
echo ""

# --- Check DNS resolves ---
echo "==> Checking DNS for $TEST_DOMAIN"
RESOLVED_IP=$(dig +short "$TEST_DOMAIN" 2>/dev/null | tail -1)
if [[ "$RESOLVED_IP" != "$DROPLET_IP" ]]; then
  echo "WARNING: $TEST_DOMAIN resolves to '${RESOLVED_IP:-<nothing>}', expected $DROPLET_IP"
  echo "         DNS may not have propagated yet. Continuing anyway..."
  echo ""
fi

# --- Deploy test container ---
echo "==> Deploying hello-world test container"
ssh $SSH_OPTS "$SSH_TARGET" bash -s -- "$TEST_DOMAIN" <<'REMOTE_DEPLOY'
set -euo pipefail

TEST_DOMAIN="$1"

# Remove existing test container if present
if docker ps -a --format '{{.Names}}' | grep -qx caddy-test-hello; then
  echo "  Removing existing test container"
  docker rm -f caddy-test-hello >/dev/null
fi

docker run -d \
  --name caddy-test-hello \
  --network caddy \
  --label "caddy=${TEST_DOMAIN}" \
  --label 'caddy.reverse_proxy={{upstreams 8000}}' \
  crccheck/hello-world

echo "  Container started. Waiting for Caddy to pick it up..."
sleep 5
REMOTE_DEPLOY

# --- Test the endpoint ---
echo "==> Curling https://$TEST_DOMAIN"
echo ""

HTTP_CODE=$(curl -s -o /tmp/caddy-test-response -w "%{http_code}" \
  --max-time 15 \
  --retry 3 \
  --retry-delay 5 \
  "https://$TEST_DOMAIN" 2>/dev/null) || true

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "--- Response (HTTP $HTTP_CODE) ---"
  cat /tmp/caddy-test-response
  echo ""
  echo "--- End response ---"
  echo ""
  echo "SUCCESS: $TEST_DOMAIN is working."
else
  echo "FAILED: Got HTTP $HTTP_CODE (expected 200)"
  echo ""
  if [[ -f /tmp/caddy-test-response ]]; then
    echo "Response body:"
    cat /tmp/caddy-test-response
    echo ""
  fi
  echo ""
  echo "Troubleshooting:"
  echo "  - Check DNS: dig +short $TEST_DOMAIN"
  echo "  - Check Caddy logs: ssh $SSH_OPTS $SSH_TARGET docker logs caddy"
  echo "  - Check container: ssh $SSH_OPTS $SSH_TARGET docker logs caddy-test-hello"
fi

rm -f /tmp/caddy-test-response

# --- Cleanup ---
echo ""
read -rp "Remove test container? [Y/n] " REPLY
if [[ "${REPLY:-Y}" =~ ^[Yy]?$ ]]; then
  echo "==> Removing test container"
  ssh $SSH_OPTS "$SSH_TARGET" "docker rm -f caddy-test-hello >/dev/null"
  echo "  Done."
else
  echo "  Leaving caddy-test-hello running on $DROPLET_NAME."
  echo "  Remove later: ssh $SSH_OPTS $SSH_TARGET docker rm -f caddy-test-hello"
fi
