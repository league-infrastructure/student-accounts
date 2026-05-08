#!/usr/bin/env bash
# secrets-sync.sh <env> — sync swarm secrets from dotconfig env into Docker.
# Only keys listed under environments.<env>.swarm_secrets in deploy.config.yaml
# are turned into Docker secrets, named "<stack>_<KEY>".
# Swarm secrets are immutable — existing ones are removed and recreated.
SCRIPT_NAME=secrets-sync
source "$(dirname "$0")/_lib.sh"

require_env_arg "${1:-}"
ENV_NAME="$1"

load_env_config "$ENV_NAME"
[[ "$BACKEND" == "swarm" ]] || fail "secrets-sync only applies to swarm backend (env '$ENV_NAME' is $BACKEND)"

write_env_file "$ENV_NAME"
use_context "$CONTEXT"

ALLOW="$(yq -r ".environments.${ENV_NAME}.swarm_secrets[]?" "$DEPLOY_CFG" 2>/dev/null | sort -u)"
if [[ -z "$ALLOW" ]]; then
  log "no swarm_secrets configured for '$ENV_NAME' — nothing to do"
  exit 0
fi

log "syncing $(echo "$ALLOW" | wc -l | tr -d ' ') secret(s) into stack '$STACK'"
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  KEY="${line%%=*}"
  VAL="${line#*=}"
  echo "$ALLOW" | grep -qx "$KEY" || continue

  NAME="${STACK}_${KEY}"
  if docker secret inspect "$NAME" >/dev/null 2>&1; then
    docker secret rm "$NAME" >/dev/null
  fi
  printf '%s' "$VAL" | docker secret create "$NAME" - >/dev/null
  log "  $NAME"
done < "$ENV_FILE"
