#!/usr/bin/env bash
# entrypoint.sh — run Prisma migrations then exec the server.
# Migrations are idempotent; safe to run on every container start.
set -euo pipefail

echo "[entrypoint] running prisma migrate deploy"
npx --no-install prisma migrate deploy

echo "[entrypoint] starting: $*"
exec "$@"
