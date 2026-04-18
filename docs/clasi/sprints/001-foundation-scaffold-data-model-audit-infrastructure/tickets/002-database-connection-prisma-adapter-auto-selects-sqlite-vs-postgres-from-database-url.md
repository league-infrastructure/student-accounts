---
id: "002"
title: "Database connection — Prisma adapter auto-selects SQLite vs Postgres from DATABASE_URL"
status: todo
use-cases: [SUC-003, SUC-005]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# Database connection — Prisma adapter auto-selects SQLite vs Postgres from DATABASE_URL

## Description

The template's `prisma.ts` currently always initialises the Prisma client with
the `@prisma/adapter-better-sqlite3` adapter. This application uses SQLite
for dev/test (via `DATABASE_URL=file:./data/...`) and PostgreSQL in production
(via a `postgresql://` connection string). This ticket makes `prisma.ts`
inspect `DATABASE_URL` and select the appropriate adapter automatically, so
no code changes are needed when moving between environments.

The `prisma/schema.prisma` datasource must also switch from `provider =
"sqlite"` to `provider = "postgresql"` with an env-var override for SQLite
in dev — or the preferred approach of using the Prisma driver adapters
feature (`previewFeatures = ["driverAdapters"]`) which allows a single schema
to work with both adapters at runtime.

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma` datasource uses `provider = "postgresql"`
      with `previewFeatures = ["driverAdapters"]` so the Prisma client is
      adapter-agnostic at the schema level.
- [ ] `server/src/services/prisma.ts` `initPrisma()` function reads
      `DATABASE_URL`:
      - If it starts with `file:`, initialises with
        `@prisma/adapter-better-sqlite3`.
      - Otherwise, initialises with no adapter (native Postgres connector).
- [ ] `npx prisma generate` runs without errors after the schema change.
- [ ] `npx prisma migrate dev` (against a dev Postgres container provisioned
      via `rundbat`) applies cleanly.
- [ ] Running `npm run test:server` with `DATABASE_URL=file:./data/test.db`
      uses SQLite and all existing tests pass.
- [ ] `server/src/env.ts` is imported first in `server/src/index.ts` (before
      any Prisma init) so `DATABASE_URL` is available from `.env` in local dev.

## Implementation Plan

### Approach

The key change is in `prisma.ts`. The `schema.prisma` change to
`driverAdapters` preview feature is necessary to allow the schema to work
with both adapters. The generator output path remains
`../src/generated/prisma`.

### Files to Modify

- `server/prisma/schema.prisma` — update datasource to `provider =
  "postgresql"`, add `previewFeatures = ["driverAdapters"]` to the
  generator block.
- `server/src/services/prisma.ts` — update `getPrismaClient()` to branch on
  `DATABASE_URL` prefix: `file:` → SQLite adapter, otherwise → no adapter.
- `server/src/index.ts` — verify `env.ts` is the first import.

### Testing Plan

- Run `npm run test:server` with `DATABASE_URL=file:./data/test.db` (default
  test setup) — must pass.
- Manually test Postgres path: set `DATABASE_URL` to the dev Postgres
  connection string from `rundbat get_environment_config`, start the server,
  confirm `GET /api/health` returns 200 (health check added in T009, but the
  server startup is sufficient here).
- Run `npm run build` to confirm TypeScript compiles.

### Documentation Updates

Update `server/prisma/schema.prisma` comment to note the dual-adapter
strategy. No other doc changes needed — the architecture document already
describes this approach.
