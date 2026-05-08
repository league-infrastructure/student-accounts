#!/usr/bin/env bash
# _lib.sh — shared helpers for deploy command scripts (up/down/logs/ps/...).
# Sourced, not executed directly. Each command script should:
#   SCRIPT_NAME=up
#   source "$(dirname "$0")/_lib.sh"
#   require_env_arg "${1:-}"
#   ENV_NAME="$1"
#   load_env_config "$ENV_NAME"
#   ...
#
# Reads config/deploy.config.yaml. Requires `yq` (mikefarah's Go version)
# and `dotconfig`.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_CFG="${DEPLOY_CONFIG:-$PROJECT_ROOT/config/deploy.config.yaml}"

log()  { printf '[%s] %s\n' "${SCRIPT_NAME:-deploy}" "$*" >&2; }
fail() { printf '[%s] error: %s\n' "${SCRIPT_NAME:-deploy}" "$*" >&2; exit 1; }

# Read a value from deploy.config.yaml. Scalars print as-is, sequences as
# space-separated. Missing keys print empty.
#   yread .environments.dev.backend
#   yread .environments.dev.compose_files
yread() {
  command -v yq >/dev/null 2>&1 || fail "yq (mikefarah Go version) is required"
  yq -r "[$1] | flatten | join(\" \")" "$DEPLOY_CFG"
}

require_env_arg() {
  if [[ -z "${1:-}" ]]; then
    local envs
    envs="$(yq -r '.environments | keys | join(" ")' "$DEPLOY_CFG" 2>/dev/null || echo '')"
    echo "Usage: $0 <env>" >&2
    echo "Available envs: $envs" >&2
    exit 2
  fi
}

# Populate globals from deploy.config.yaml for the given env:
#   BACKEND        compose | swarm
#   CONTEXT        docker context name (may be empty)
#   COMPOSE_F_ARGS array of `-f file ...` flags (compose only)
#   STACK          stack name (swarm)
#   STACK_FILE     stack file (swarm)
load_env_config() {
  local env="$1"
  BACKEND="$(yread .environments.${env}.backend)"
  [[ -z "$BACKEND" ]] && BACKEND="$(yread .default_backend)"
  [[ -z "$BACKEND" ]] && fail "no backend configured for env '$env'"

  CONTEXT="$(yread .environments.${env}.context)"

  local files
  files="$(yread .environments.${env}.compose_files)"
  [[ -z "$files" ]] && files="docker-compose.yaml"
  COMPOSE_F_ARGS=()
  for f in $files; do COMPOSE_F_ARGS+=(-f "$f"); done

  STACK="$(yread .environments.${env}.stack)"
  [[ -z "$STACK" ]] && STACK="$env"
  STACK_FILE="$(yread .environments.${env}.stack_file)"
  [[ -z "$STACK_FILE" ]] && STACK_FILE="docker-stack.yaml"
  return 0
}

# Write merged dotconfig env to .deploy/.env.<env>. Sets ENV_FILE.
# Reused on every up to refresh values from the latest dotconfig state.
write_env_file() {
  local env="$1"
  mkdir -p "$PROJECT_ROOT/.deploy"
  ENV_FILE="$PROJECT_ROOT/.deploy/.env.$env"
  : > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  "$PROJECT_ROOT/scripts/config-load.sh" "$env" > "$ENV_FILE"
  log "wrote $ENV_FILE ($(wc -l < "$ENV_FILE") lines)"
}

# Switch docker context if non-empty. Registers a trap to revert on exit.
use_context() {
  local ctx="${1:-}"
  [[ -z "$ctx" ]] && return 0
  docker context inspect "$ctx" >/dev/null 2>&1 \
    || fail "docker context '$ctx' not found. Create with: docker context create $ctx --docker host=ssh://user@host"
  local prev
  prev="$(docker context show)"
  [[ "$prev" == "$ctx" ]] && return 0
  log "docker context: $prev -> $ctx"
  docker context use "$ctx" >/dev/null
  trap 'docker context use '"$prev"' >/dev/null 2>&1 || true' EXIT
}

# Export IMAGE_TAG from the root package.json so compose interpolation pins
# the deployment to a specific version. Compose has no fallback in the YAML —
# if package.json is missing or unparseable, we fail loud instead of silently
# pulling :latest.
IMAGE_TAG="$(node -p "require('$PROJECT_ROOT/package.json').version" 2>/dev/null || true)"
[[ -z "$IMAGE_TAG" ]] && fail "could not read version from package.json"
export IMAGE_TAG

cd "$PROJECT_ROOT"
