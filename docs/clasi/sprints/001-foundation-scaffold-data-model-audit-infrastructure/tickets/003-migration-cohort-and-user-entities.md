---
id: "003"
title: "Migration — Cohort and User entities"
status: todo
use-cases: [SUC-003]
depends-on: ["002"]
github-issue: ""
todo: ""
---

# Migration — Cohort and User entities

## Description

Create the `Cohort` and `User` Prisma models and their migration. This
removes the template demo User columns (`provider`, `providerId`, `avatarUrl`,
`providers` relation) and the `UserProvider` model, replacing them with the
application's domain User model. `Cohort` is created first because `User`
has a nullable FK to it.

The existing `Config`, `Session`, `ScheduledJob` models are untouched.

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma` defines:
  - `Cohort` model: `id`, `name` (unique), `google_ou_path` (optional),
    `created_at`.
  - `User` model: `id`, `display_name`, `primary_email` (unique), `role`
    (enum: student/staff/admin, default student), `created_via` (enum:
    social_login/pike13_sync/admin_created), `cohort_id` (nullable FK →
    Cohort), `created_at`, `updated_at`.
  - `UserRole` and `CreatedVia` enums.
  - Index on `User(role)` and `User(cohort_id)`.
  - `UserProvider` model is removed.
- [ ] `npx prisma migrate dev --name cohort-and-user` generates a migration
      that applies cleanly on a fresh Postgres database.
- [ ] `npx prisma migrate dev` also applies cleanly on a fresh SQLite
      database (used by integration tests).
- [ ] `npx prisma generate` regenerates the client without errors.
- [ ] The generated Prisma client exports `Cohort`, `User`, `UserRole`,
      `CreatedVia` types.
- [ ] `npm run build` passes with no TypeScript errors. (Note: `user.service.ts`
      may need a minimal update to remove references to deleted columns; keep
      changes to only what is required to compile — full rewrite is T008.)

## Implementation Plan

### Approach

Edit `schema.prisma` directly to add the new models and enums, remove
`UserProvider` and the demo User columns. Then run `prisma migrate dev`.
SQLite does not support column drops natively — Prisma's migration generator
handles this via a table-recreation strategy for SQLite; verify the generated
SQL is correct before committing.

### Files to Modify

- `server/prisma/schema.prisma` — add `Cohort`, `User` (domain version),
  `UserRole`, `CreatedVia` enums; remove `UserProvider` and demo User
  columns (`provider`, `providerId`, `avatarUrl`).
- `server/src/services/user.service.ts` — minimal changes only: remove
  references to deleted columns (`provider`, `providerId`, `avatarUrl`,
  `providers`) so the file compiles. Full rewrite is T008.

### Open Question for Implementer

Before proceeding: confirm with stakeholder (or accept default below) the
`onDelete` behaviour for the `cohort_id` FK on User:
- Default: `onDelete: SetNull` — removing a Cohort NULLs `cohort_id` on
  affected Users (they become cohort-less but are not deleted).
- Alternative: `onDelete: Restrict` — prevents Cohort deletion while any
  User belongs to it.

The default (`SetNull`) is recommended — it preserves user records and
allows cohort cleanup.

### Testing Plan

- `npx prisma migrate dev` on both Postgres (dev container) and SQLite
  (test DB file).
- `npx prisma generate` — no errors.
- `npm run build` — no TypeScript errors.
- `npm run test:server` — existing tests that do not reference removed
  columns should still pass.

### Documentation Updates

None beyond the schema file itself.
