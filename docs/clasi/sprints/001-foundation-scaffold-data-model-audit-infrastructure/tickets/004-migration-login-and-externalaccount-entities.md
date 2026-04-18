---
id: "004"
title: "Migration — Login and ExternalAccount entities"
status: todo
use-cases: [SUC-003]
depends-on: ["003"]
github-issue: ""
todo: ""
---

# Migration — Login and ExternalAccount entities

## Description

Create the `Login` and `ExternalAccount` Prisma models and their migration.
Both depend on `User` (created in T003). This ticket also adds the partial
unique index on `ExternalAccount(user_id, type)` scoped to
`status IN ('pending', 'active')` — this cannot be expressed in Prisma DDL
and must be added as a raw SQL step in the migration.

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma` defines:
  - `Login` model: `id`, `user_id` (FK → User, `onDelete: Restrict`),
    `provider` (string: 'google'|'github'), `provider_user_id`,
    `provider_email` (optional), `created_at`. Composite unique:
    `(provider, provider_user_id)`. Index on `user_id`.
  - `ExternalAccount` model: `id`, `user_id` (FK → User, `onDelete: Restrict`),
    `type` (enum: workspace/claude/pike13), `external_id` (optional),
    `status` (enum: pending/active/suspended/removed, default pending),
    `created_at`, `status_changed_at` (optional). Index on `(user_id)` and
    `(type, status)`.
  - `ExternalAccountType` and `ExternalAccountStatus` enums.
- [ ] The migration SQL for `ExternalAccount` includes a raw SQL step that
      creates a partial unique index:
      `CREATE UNIQUE INDEX IF NOT EXISTS "ExternalAccount_user_id_type_active_key"
      ON "ExternalAccount"("user_id", "type")
      WHERE "status" IN ('pending', 'active');`
      This index must be present in the migration file (not just the schema).
- [ ] The partial unique index syntax is verified to work in both SQLite
      (dev/test) and Postgres (CI/production). SQLite supports partial
      indexes using the `WHERE` clause. Run the migration against both
      engines and confirm the index is present and enforces uniqueness
      before marking this ticket done. (Stakeholder decision, 2026-04-18.)
- [ ] `npx prisma migrate dev --name login-and-external-account` generates
      and applies cleanly on fresh Postgres and SQLite databases.
- [ ] `npx prisma generate` regenerates the client without errors.
- [ ] The generated client exports `Login`, `ExternalAccount`,
      `ExternalAccountType`, `ExternalAccountStatus` types.
- [ ] `npm run build` passes with no TypeScript errors.

## Implementation Plan

### Approach

Edit `schema.prisma` to add the two models. Run `prisma migrate dev` to
generate the migration SQL. Then manually append the raw SQL partial
index to the generated migration file before committing. The `@@index`
directive covers the plain indexes; the partial index is added by hand.

### Files to Modify

- `server/prisma/schema.prisma` — add `Login`, `ExternalAccount`,
  `ExternalAccountType`, `ExternalAccountStatus`.
- The generated migration file — append the partial unique index SQL.

### Partial Index Note

The canonical raw SQL to add to the migration:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalAccount_user_id_type_active_key"
ON "ExternalAccount"("user_id", "type")
WHERE "status" IN ('pending', 'active');
```

Verify this runs on the test SQLite DB: `DATABASE_URL=file:./data/test.db
npx prisma migrate dev`. SQLite supports partial indexes since 3.8.9.

### Testing Plan

- Apply migration on Postgres (dev container) and SQLite (test DB).
- `npm run build` — no errors.
- `npm run test:server` — existing passing tests remain passing.
- Manual verification of the partial unique index: insert two
  ExternalAccounts for the same user+type with status=active — expect a
  UNIQUE constraint violation. Insert one active and one removed — expect
  success.

### Documentation Updates

None beyond schema and migration files.
