#!/usr/bin/env bash
set -euo pipefail

# setup-local.sh — Configure your local machine to access docker1.
#
# This script:
#   1. Copies the deploy key to ~/.ssh/do-deploy-key (if not already there)
#   2. Adds an SSH config entry for docker1
#   3. Creates a Docker context for docker1
#
# Usage:
#   ./digital-ocean/servers/docker1/setup-local.sh
#
# After running, you can:
#   ssh docker1                              # SSH into the server
#   docker context use docker1               # switch Docker to this server
#   DOCKER_CONTEXT=docker1 docker ps         # one-off command on the server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load server info
source "$SCRIPT_DIR/server.env"

# Find the deploy key (in the digital-ocean dir, two levels up)
DO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_KEY="$DO_DIR/deploy-key"
DEST_KEY="$HOME/.ssh/do-deploy-key"

echo "==> Setting up local access to $DROPLET_NAME ($DROPLET_IP)"
echo "    Domain: *.$APPS_DOMAIN"
echo ""

# --- Step 1: Deploy key ---
if [[ -f "$DEST_KEY" ]]; then
  echo "  Deploy key already at $DEST_KEY"
else
  if [[ -f "$SOURCE_KEY" ]]; then
    cp "$SOURCE_KEY" "$DEST_KEY"
    chmod 600 "$DEST_KEY"
    echo "  Copied deploy key to $DEST_KEY"
  else
    echo "ERROR: Deploy key not found at $SOURCE_KEY"
    echo "       Ask your instructor for the deploy-key file and place it at:"
    echo "       $SOURCE_KEY"
    exit 1
  fi
fi

# --- Step 2: SSH config ---
SSH_CONFIG="$HOME/.ssh/config"
HOST_ALIAS="$DROPLET_NAME"

# Check if entry already exists
if grep -q "^Host $HOST_ALIAS\$" "$SSH_CONFIG" 2>/dev/null; then
  echo "  SSH config entry for '$HOST_ALIAS' already exists"
else
  mkdir -p "$HOME/.ssh"
  touch "$SSH_CONFIG"
  chmod 600 "$SSH_CONFIG"

  cat >> "$SSH_CONFIG" <<SSH_ENTRY

# $DROPLET_NAME — DigitalOcean Docker server (*.$APPS_DOMAIN)
Host $HOST_ALIAS
    HostName $DROPLET_IP
    User root
    IdentityFile $DEST_KEY
    IdentitiesOnly yes
SSH_ENTRY

  echo "  Added SSH config entry: Host $HOST_ALIAS → $DROPLET_IP"
fi

# --- Step 3: Docker context ---
if docker context inspect "$DROPLET_NAME" >/dev/null 2>&1; then
  echo "  Docker context '$DROPLET_NAME' already exists"
else
  docker context create "$DROPLET_NAME" \
    --docker "host=ssh://$HOST_ALIAS"
  echo "  Created Docker context: $DROPLET_NAME"
fi

echo ""
echo "==> Done! You can now:"
echo "  ssh $HOST_ALIAS                             # SSH into the server"
echo "  docker context use $DROPLET_NAME              # switch Docker to this server"
echo "  DOCKER_CONTEXT=$DROPLET_NAME docker ps        # list containers on the server"
echo ""
