---
id: '003'
title: Add Counter backend (model, migration, routes, seed)
status: done
use-cases:
- SUC-003
depends-on:
- '001'
github-issue: ''
todo: plan-revert-template-app-to-simple-two-button-counter-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 003 — Add Counter backend (model, migration, routes, seed)

## Description

Add the `Counter` Prisma model, create the database migration, implement the two counter
API endpoints, and seed the database with `alpha` and `beta` starting at zero.

Depends on ticket 001 (schema.prisma must have domain models removed before this adds
Counter). Runs in Group 2 parallel with ticket 004.

## Files to Create

**`server/src/routes/counters.ts`:**
- `GET /api/counters` — returns array of all counters `[{ name, value }]`; requires auth
  (`requireAuth` middleware).
- `POST /api/counters/:name/increment` — upsert: if counter exists, increment `value` by
  1; if not, create with `value = 1`; return `{ name, value }`; requires auth.

**`server/prisma/seed.ts`** (or extend existing seed file):
- Upsert `Counter` rows: `{ name: "alpha", value: 0 }`, `{ name: "beta", value: 0 }`.
  Use `upsert` so running seed twice is idempotent.

## Files to Modify

**`server/prisma/schema.prisma`:**
Add the `Counter` model after the `User` model:
```
model Counter {
  id        String   @id @default(uuid())
  name      String   @unique
  value     Int      @default(0)
  updatedAt DateTime @updatedAt
}
```

**`server/src/app.ts`:**
- Import `countersRouter` from `./routes/counters`.
- Register: `app.use('/api/counters', requireAuth, countersRouter)` (after auth middleware
  setup, before the catch-all).

**`server/package.json`** (if no seed script exists):
- Add `"prisma": { "seed": "ts-node server/prisma/seed.ts" }` to enable `prisma db seed`.

## Migration

After modifying `schema.prisma`:
```
npx prisma migrate dev --name add-counter-model
```
This generates a migration that creates the `Counter` table. The dev SQLite database will be
reset if the prior migration dropped the 15 LEAGUEhub tables (expected after ticket 001's
schema changes are committed).

Run seed after migration:
```
npx prisma db seed
```

## Acceptance Criteria

- [x] `Counter` model present in `schema.prisma` with correct fields
- [x] Migration generated and applies cleanly (`npx prisma migrate dev`)
- [x] `GET /api/counters` returns JSON array; requires authentication (401 if unauthenticated)
- [x] `POST /api/counters/alpha/increment` increments `alpha` and returns `{ name: "alpha", value: N }`
- [x] `POST /api/counters/unknown/increment` auto-creates a counter with `value = 1`
- [x] Seed inserts `alpha` and `beta` rows idempotently
- [x] Counter values persist across server restart (stored in DB, not memory)
- [x] TypeScript compiles without errors

## Implementation Plan

1. Add `Counter` model to `schema.prisma`.
2. Run `npx prisma migrate dev --name add-counter-model`.
3. Create `server/src/routes/counters.ts` with GET and POST endpoints.
4. Write or extend `server/prisma/seed.ts` with counter upserts.
5. Edit `server/src/app.ts` to import and mount `countersRouter`.
6. Verify seed script runs: `npx prisma db seed`.
7. Test endpoints manually or via test.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `POST /api/counters/:name/increment` with existing counter → value +1
  - `POST /api/counters/:name/increment` with new counter name → value = 1 (upsert)
  - `GET /api/counters` returns array including seeded `alpha` and `beta`
  - `POST /api/counters/:name/increment` without auth → 401
- **Verification command**: `npm run test:server`
