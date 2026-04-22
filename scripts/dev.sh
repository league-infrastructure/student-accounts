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

# Prisma bootstrap: SQLite dev uses `db push` (no migration history), Postgres
# uses `migrate deploy` (migration history is canonical).
DB_CMD="npx prisma db push --skip-generate --accept-data-loss"
case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*) DB_CMD="npx prisma migrate deploy" ;;
esac

exec npx concurrently -n server,client -c green,magenta \
  "cd server && npx prisma generate && $DB_CMD && npm run dev" \
  "cd client && npx wait-on http://localhost:3000/api/health && npx vite --host"
