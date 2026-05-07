#!/usr/bin/env bash
# deploy.sh — one-command deploy dispatcher
#
# Usage:
#   scripts/deploy.sh <env> [action]
#
#   <env>     one of the deployments configured for this project (dev|prod|test|...)
#   [action]  up | down | logs | build | ps | secrets-sync   (default: up)
#
# Behavior:
#   1. Resolve target backend for <env> from project config (compose|swarm|fly|render).
#   2. Source the right env file via scripts/config-load.sh (dotconfig or fallback).
#   3. Switch docker context if the backend is compose/swarm and a context is named.
#   4. Dispatch to the right backend with the right compose files.
#
# This script is meant to be COPIED INTO YOUR PROJECT (scripts/deploy.sh) and edited.
# It does not depend on the deploy-expert plugin at runtime.

set -euo pipefail

# --- locate project root ----------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# --- args -------------------------------------------------------------------
ENV_NAME="${1:-}"
ACTION="${2:-up}"

if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: $0 <env> [up|down|logs|build|ps|secrets-sync]" >&2
  echo "Available envs: $(ls config/ 2>/dev/null | grep -v '^local$\|^sops.yaml$' | tr '\n' ' ')" >&2
  exit 2
fi

# --- read config/deploy.config.yaml (project-level deploy settings) ----------------
# This is a small YAML file you commit. Example:
#
#   default_backend: compose
#   environments:
#     dev:
#       backend: compose
#       context: orbstack
#       compose_files: [docker-compose.yaml, docker-compose.dev.yaml]
#     prod:
#       backend: compose
#       context: lab-prod
#       compose_files: [docker-compose.yaml]
#     fly-prod:
#       backend: fly
#       app: myapp
#     render-prod:
#       backend: render
#
DEPLOY_CFG="${DEPLOY_CONFIG:-config/deploy.config.yaml}"

if [[ ! -f "$DEPLOY_CFG" ]]; then
  echo "error: $DEPLOY_CFG not found." >&2
  echo "       Run /deploy-init in Claude to generate it, or create one by hand." >&2
  exit 1
fi

# Tiny YAML reader: yq if present, else python.
yread() {
  local path="$1"
  if command -v yq >/dev/null 2>&1; then
    yq -r "$path // \"\"" "$DEPLOY_CFG"
  else
    python3 -c "
import sys, yaml, functools
d = yaml.safe_load(open('$DEPLOY_CFG')) or {}
parts = '$path'.lstrip('.').split('.')
cur = d
for p in parts:
    if isinstance(cur, dict) and p in cur:
        cur = cur[p]
    else:
        cur = ''
        break
if isinstance(cur, list):
    print(' '.join(map(str, cur)))
else:
    print(cur if cur is not None else '')
"
  fi
}

BACKEND="$(yread .environments.$ENV_NAME.backend)"
[[ -z "$BACKEND" ]] && BACKEND="$(yread .default_backend)"
[[ -z "$BACKEND" ]] && { echo "error: no backend configured for env '$ENV_NAME'" >&2; exit 1; }

# --- load env file via config adapter --------------------------------------
ENV_FILE="$(mktemp -t deploy.env.XXXXXX)"
trap 'rm -f "$ENV_FILE"' EXIT

scripts/config-load.sh "$ENV_NAME" > "$ENV_FILE"

# Export the env into the script's own environment so substitutions work
# in compose interpolation. We do NOT print the env to stdout.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# --- per-backend dispatch ---------------------------------------------------
case "$BACKEND" in

  compose)
    CONTEXT="$(yread .environments.$ENV_NAME.context)"
    FILES="$(yread .environments.$ENV_NAME.compose_files)"
    [[ -z "$FILES" ]] && FILES="docker-compose.yaml"

    # build -f flags
    F_ARGS=()
    for f in $FILES; do F_ARGS+=(-f "$f"); done

    if [[ -n "$CONTEXT" ]]; then
      if ! docker context inspect "$CONTEXT" >/dev/null 2>&1; then
        echo "error: docker context '$CONTEXT' does not exist." >&2
        echo "       create it with: docker context create $CONTEXT --docker host=ssh://user@host" >&2
        exit 1
      fi
      PREV_CONTEXT="$(docker context show)"
      docker context use "$CONTEXT" >/dev/null
      trap 'docker context use "$PREV_CONTEXT" >/dev/null 2>&1 || true; rm -f "$ENV_FILE"' EXIT
    fi

    case "$ACTION" in
      up)    docker compose "${F_ARGS[@]}" --env-file "$ENV_FILE" up -d --build --remove-orphans ;;
      down)  docker compose "${F_ARGS[@]}" --env-file "$ENV_FILE" down ;;
      build) docker compose "${F_ARGS[@]}" --env-file "$ENV_FILE" build ;;
      logs)  docker compose "${F_ARGS[@]}" --env-file "$ENV_FILE" logs -f --tail=200 ;;
      ps)    docker compose "${F_ARGS[@]}" --env-file "$ENV_FILE" ps ;;
      secrets-sync) echo "compose backend uses env_file; nothing to sync." ;;
      *) echo "error: unknown action '$ACTION'" >&2; exit 2 ;;
    esac
    ;;

  swarm)
    CONTEXT="$(yread .environments.$ENV_NAME.context)"
    STACK="$(yread .environments.$ENV_NAME.stack)"
    [[ -z "$STACK" ]] && STACK="$ENV_NAME"
    STACK_FILE="$(yread .environments.$ENV_NAME.stack_file)"
    [[ -z "$STACK_FILE" ]] && STACK_FILE="docker-stack.yaml"

    if [[ -n "$CONTEXT" ]]; then
      docker context use "$CONTEXT" >/dev/null
    fi

    case "$ACTION" in
      up)
        # Sync swarm secrets from the loaded env. Each KEY=VAL becomes a docker secret
        # named <stack>_<KEY> if marked in config.
        scripts/swarm-secrets.sh "$ENV_FILE" "$STACK" || true
        docker stack deploy -c "$STACK_FILE" --with-registry-auth "$STACK"
        ;;
      down) docker stack rm "$STACK" ;;
      logs) docker service logs -f "$(docker service ls --filter label=com.docker.stack.namespace=$STACK -q | head -1)" ;;
      ps)   docker stack ps "$STACK" ;;
      secrets-sync) scripts/swarm-secrets.sh "$ENV_FILE" "$STACK" ;;
      *) echo "error: unknown action '$ACTION' for swarm" >&2; exit 2 ;;
    esac
    ;;

  fly)
    APP="$(yread .environments.$ENV_NAME.app)"
    [[ -z "$APP" ]] && { echo "error: fly backend needs .environments.$ENV_NAME.app" >&2; exit 1; }
    FLY_CONFIG="$(yread .environments.$ENV_NAME.config)"
    [[ -z "$FLY_CONFIG" ]] && FLY_CONFIG="fly.toml"

    case "$ACTION" in
      up)
        # Push secrets from env file (lines that match a configured prefix list).
        if [[ -s "$ENV_FILE" ]]; then
          # shellcheck disable=SC2046
          flyctl secrets import --app "$APP" --stage < "$ENV_FILE"
        fi
        flyctl deploy --app "$APP" --config "$FLY_CONFIG" --remote-only
        ;;
      down) flyctl apps destroy "$APP" --yes ;;
      logs) flyctl logs --app "$APP" ;;
      ps)   flyctl status --app "$APP" ;;
      secrets-sync)
        flyctl secrets import --app "$APP" < "$ENV_FILE"
        ;;
      *) echo "error: unknown action '$ACTION' for fly" >&2; exit 2 ;;
    esac
    ;;

  render)
    SERVICE="$(yread .environments.$ENV_NAME.service)"
    case "$ACTION" in
      up)
        echo "Render uses git-push or blueprint deploys."
        echo "  - blueprint: commit render.yaml and connect the repo in Render."
        echo "  - manual:    git push to the branch Render is watching."
        echo ""
        echo "Env vars to set in Render dashboard for service '$SERVICE':"
        grep -v '^\s*#\|^\s*$' "$ENV_FILE" || true
        ;;
      logs) echo "Render logs live in the dashboard. Open https://dashboard.render.com" ;;
      *) echo "Render action '$ACTION' is not automatable from this script." >&2; exit 2 ;;
    esac
    ;;

  *)
    echo "error: unknown backend '$BACKEND' for env '$ENV_NAME'" >&2
    exit 1
    ;;
esac
