#!/usr/bin/env bash
# config-load.sh — emit a merged .env for a deployment to stdout.
#
# Usage: scripts/config-load.sh <env_name>
#
# Resolution order (first one that works wins):
#   1. dotconfig CLI + config/<env>/{public,secrets}.env  (preferred)
#   2. .env.<env> at project root
#   3. .env (only if env name == "default" or matches CONFIG_DEPLOY in .env)
#
# Output: KEY=VALUE lines, no comments, no `export` prefix. Suitable for
#         `--env-file`, `flyctl secrets import`, etc.
#
# This script is meant to be COPIED INTO YOUR PROJECT and edited if needed.

set -euo pipefail

ENV_NAME="${1:-}"
[[ -z "$ENV_NAME" ]] && { echo "Usage: $0 <env_name>" >&2; exit 2; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# --- 1. dotconfig path -------------------------------------------------------
if command -v dotconfig >/dev/null 2>&1 && [[ -d "config/$ENV_NAME" ]]; then
  # Per-developer overrides if config/local/$USER exists
  EXTRA=()
  if [[ -d "config/local/${USER:-}" ]]; then
    EXTRA+=(-l "$USER")
  fi
  dotconfig load -d "$ENV_NAME" ${EXTRA[@]+"${EXTRA[@]}"} --stdout --no-export
  exit 0
fi

# --- 2. .env.<env> fallback --------------------------------------------------
if [[ -f ".env.$ENV_NAME" ]]; then
  # strip comments & blank lines, drop `export ` prefix if present
  grep -vE '^\s*(#|$)' ".env.$ENV_NAME" | sed -E 's/^export +//'
  exit 0
fi

# --- 3. plain .env, but only if it claims this env ---------------------------
if [[ -f ".env" ]]; then
  CURRENT="$(grep -E '^CONFIG_DEPLOY=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)"
  if [[ "$CURRENT" == "$ENV_NAME" || "$ENV_NAME" == "default" ]]; then
    grep -vE '^\s*(#|$)' .env | sed -E 's/^export +//'
    exit 0
  fi
fi

cat >&2 <<EOF
error: no config source found for env '$ENV_NAME'.
       Tried:
         - dotconfig load -d $ENV_NAME    (config/$ENV_NAME/ not present, or 'dotconfig' CLI missing)
         - .env.$ENV_NAME                 (not present at project root)
         - .env with CONFIG_DEPLOY=$ENV_NAME  (not matched)

       Fix one of:
         a) Run 'dotconfig init' and create config/$ENV_NAME/public.env
         b) Create .env.$ENV_NAME at project root
EOF
exit 1
