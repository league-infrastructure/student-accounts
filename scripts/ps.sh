#!/usr/bin/env bash
# ps.sh <env> — show running containers / tasks for a deployment.
SCRIPT_NAME=ps
source "$(dirname "$0")/_lib.sh"

require_env_arg "${1:-}"
ENV_NAME="$1"

load_env_config "$ENV_NAME"
use_context "$CONTEXT"

case "$BACKEND" in
  compose) docker compose "${COMPOSE_F_ARGS[@]}" ps ;;
  swarm)   docker stack ps "$STACK" ;;
  *)       fail "unknown backend: $BACKEND" ;;
esac
