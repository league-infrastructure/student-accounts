#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Load environment
set -a
. ./.env 2>/dev/null || true
set +a

# SQLite mode — no Docker needed
exec npx concurrently -n server,client -c green,magenta \
  "cd server && npx prisma generate && npx prisma migrate dev && npm run dev" \
  "cd client && npx wait-on http://localhost:3000/api/health && npx vite --host"
