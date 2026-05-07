#!/usr/bin/env bash
# swarm-secrets.sh — convert an env file into Docker Swarm secrets.
#
# Usage: scripts/swarm-secrets.sh <env_file> <stack_name>
#
# Reads <env_file> and creates one swarm secret per line, named "<stack>_<KEY>".
# Existing secrets with the same name are removed and recreated (Swarm secrets
# are immutable; rotation requires recreate).
#
# Only KEYs listed in config/deploy.config.yaml under environments.<env>.swarm_secrets
# are turned into secrets. Everything else is left as plain env in compose.

set -euo pipefail

ENV_FILE="${1:-}"
STACK="${2:-}"
[[ -z "$ENV_FILE" || -z "$STACK" ]] && { echo "Usage: $0 <env_file> <stack>" >&2; exit 2; }

DEPLOY_CFG="${DEPLOY_CONFIG:-config/deploy.config.yaml}"

# Read the allowed-secret list
if command -v yq >/dev/null 2>&1; then
  ALLOW="$(yq -r ".environments.*.swarm_secrets[]?" "$DEPLOY_CFG" 2>/dev/null | sort -u || true)"
else
  ALLOW="$(python3 -c "
import yaml
d = yaml.safe_load(open('$DEPLOY_CFG')) or {}
out = set()
for env in (d.get('environments') or {}).values():
    for s in (env.get('swarm_secrets') or []):
        out.add(s)
print('\n'.join(sorted(out)))
")"
fi

if [[ -z "$ALLOW" ]]; then
  echo "swarm-secrets: no swarm_secrets configured; nothing to do." >&2
  exit 0
fi

while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  KEY="${line%%=*}"
  VAL="${line#*=}"

  # only keys in the allow list
  echo "$ALLOW" | grep -qx "$KEY" || continue

  SECRET_NAME="${STACK}_${KEY}"
  if docker secret inspect "$SECRET_NAME" >/dev/null 2>&1; then
    docker secret rm "$SECRET_NAME" >/dev/null
  fi
  printf '%s' "$VAL" | docker secret create "$SECRET_NAME" - >/dev/null
  echo "swarm-secrets: created $SECRET_NAME"
done < "$ENV_FILE"
