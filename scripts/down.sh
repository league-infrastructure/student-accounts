#!/usr/bin/env bash
# down.sh <env> — tear down a deployment.
SCRIPT_NAME=down
source "$(dirname "$0")/_lib.sh"

require_env_arg "${1:-}"
ENV_NAME="$1"

load_env_config "$ENV_NAME"
use_context "$CONTEXT"

case "$BACKEND" in
  compose)
    log "docker compose ${COMPOSE_F_ARGS[*]} down"
    docker compose "${COMPOSE_F_ARGS[@]}" down
    ;;
  swarm)
    log "docker stack rm $STACK"
    docker stack rm "$STACK"
    ;;
  *) fail "unknown backend: $BACKEND" ;;
esac
