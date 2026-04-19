#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Load environment.
# Relax errexit around .env sourcing: values may contain unquoted spaces
# (e.g. APP_NAME=League Web App), which bash would otherwise try to execute.
set +e
set -a
. ./.env 2>/dev/null
set +a
set -e

# SQLite mode — no Docker needed
exec npx concurrently -n server,client -c green,magenta \
  "cd server && npx prisma generate && npx prisma migrate dev && npm run dev" \
  "cd client && npx wait-on http://localhost:3000/api/health && npx vite --host"
