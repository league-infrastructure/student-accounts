# lib.sh — Shared helpers for digital-ocean scripts.
# Source this file, don't execute it directly.

# Load config.env
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$_LIB_DIR/config.env" ]]; then
  set -a
  source "$_LIB_DIR/config.env"
  set +a
fi

# Defaults
: "${DROPLET_NAME_PREFIX:=docker}"
: "${R53_DOMAIN_BASE:=jointheleague.org}"

# Deploy key for SSH
DEPLOY_KEY="$_LIB_DIR/deploy-key"
if [[ -f "$DEPLOY_KEY" ]]; then
  SSH_OPTS="-i $DEPLOY_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
else
  SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
fi

# Check DO token
require_do_token() {
  if [[ -z "${DO_LEAGUE_STUDENT_TOKEN:-}" ]]; then
    echo "ERROR: DO_LEAGUE_STUDENT_TOKEN is not set."
    echo ""
    echo "This token authenticates to The League org → Students team on DigitalOcean."
    echo ""
    echo "To fix this:"
    echo "  1. Log in to DigitalOcean and switch to The League org → Students team"
    echo "  2. Go to API → Tokens → Generate New Token (read + write scope)"
    echo "  3. Add to your shell profile (e.g. ~/.zshenv):"
    echo ""
    echo "       export DO_LEAGUE_STUDENT_TOKEN=\"dop_v1_...\""
    echo ""
    echo "  4. Reload your shell: source ~/.zshenv"
    exit 1
  fi
}

# Look up a droplet's public IP by number.
# Usage: lookup_droplet_ip <number>
# Sets: DROPLET_NAME, DROPLET_IP
lookup_droplet_ip() {
  local number="$1"
  DROPLET_NAME="${DROPLET_NAME_PREFIX}${number}"
  DROPLET_IP=$(doctl compute droplet list \
    --access-token "$DO_LEAGUE_STUDENT_TOKEN" \
    --format Name,PublicIPv4 --no-header \
    | awk -v name="$DROPLET_NAME" '$1 == name { print $2 }')

  if [[ -z "$DROPLET_IP" ]]; then
    echo "ERROR: Droplet '$DROPLET_NAME' not found."
    echo "       Check: doctl compute droplet list --access-token \$DO_LEAGUE_STUDENT_TOKEN"
    exit 1
  fi
}
