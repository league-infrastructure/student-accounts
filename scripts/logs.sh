#!/usr/bin/env bash
# logs.sh <env> — tail logs from a running deployment.
SCRIPT_NAME=logs
source "$(dirname "$0")/_lib.sh"

require_env_arg "${1:-}"
ENV_NAME="$1"

load_env_config "$ENV_NAME"
use_context "$CONTEXT"

case "$BACKEND" in
  compose)
    docker compose "${COMPOSE_F_ARGS[@]}" logs -f --tail=200
    ;;
  swarm)
    # Pick the first service in the stack — single-service projects only.
    # For multi-service stacks, run `docker service logs <stack>_<svc>` directly.
    svc="$(docker service ls --filter "label=com.docker.stack.namespace=$STACK" -q | head -1)"
    [[ -z "$svc" ]] && fail "no services found for stack '$STACK'"
    docker service logs -f --tail=200 "$svc"
    ;;
  *) fail "unknown backend: $BACKEND" ;;
esac
