---
id: '005'
title: Fix DATABASE_URL shell expansion in .env
status: done
use-cases: []
depends-on: []
---

# Fix DATABASE_URL shell expansion in .env

## Description

`.env` contains `DATABASE_URL=postgresql://app:devpassword@localhost:${DB_PORT:-5433}/app`.
dotenv does not expand shell syntax like `${DB_PORT:-5433}`, so when the
server loads `.env` via `dotenv.config()`, Prisma gets the literal string and
fails with "Invalid URL". The root `npm run dev` works around this by sourcing
`.env` through the shell first, but this is fragile.

Fix by replacing the shell variable with the plain value in `.env`.

## Acceptance Criteria

- [x] DATABASE_URL in `.env` uses plain port value (no shell expansion)
- [x] `cd server && npm run dev` works without shell sourcing
- [x] Dev login endpoint works

## Testing

- **Existing tests to run**: `npm run test:server`
- **Verification command**: `npm run test:server`
