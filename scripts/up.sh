#!/usr/bin/env bash
# up.sh <env> — bring up a deployment.
#   compose: docker compose up -d (--pull always so a freshly-pushed image is used)
#   swarm:   sync swarm secrets, then docker stack deploy
SCRIPT_NAME=up
source "$(dirname "$0")/_lib.sh"

require_env_arg "${1:-}"
ENV_NAME="$1"

load_env_config "$ENV_NAME"
write_env_file "$ENV_NAME"
use_context "$CONTEXT"

case "$BACKEND" in
  compose)
    log "deploying ${IMAGE_REPO:-ghcr.io/league-infrastructure/student-accounts}:$IMAGE_TAG"
    docker compose "${COMPOSE_F_ARGS[@]}" up -d --pull missing --remove-orphans
    ;;
  swarm)
    # Swarm `stack deploy` ignores `env_file:` directives — pre-render the stack
    # file via `docker compose config` (which inlines env_file values into
    # `environment:`), then pipe to `stack deploy`. Run the render against the
    # local context so DOCKER_HOST does not point at the swarm's daemon.
    RENDERED="$PROJECT_ROOT/.deploy/${ENV_NAME}.stack.rendered.yaml"
    log "rendering $STACK_FILE -> $RENDERED"
    DOCKER_CONTEXT=default docker compose -f "$STACK_FILE" --env-file "$ENV_FILE" \
      config > "$RENDERED"
    # `docker compose config` output has a few quirks that `stack deploy` rejects:
    #   - top-level `name:` field
    #   - numeric cpus (swarm needs a string)
    #   - empty `name:` field on the network (we already specify it via `name: caddy`)
    sed -i '' -E \
      -e '/^name: /d' \
      -e 's|^([[:space:]]+)cpus:[[:space:]]*([0-9.]+)[[:space:]]*$|\1cpus: "\2"|' \
      "$RENDERED"
    log "deploying ${IMAGE_REPO:-ghcr.io/league-infrastructure/student-accounts}:$IMAGE_TAG"
    log "docker stack deploy -c $RENDERED $STACK"
    docker stack deploy -c "$RENDERED" --with-registry-auth "$STACK"
    ;;
  *) fail "unknown backend: $BACKEND" ;;
esac
