---
id: '005'
title: "Migration \u2014 AuditEvent, ProvisioningRequest, and MergeSuggestion entities"
status: in-progress
use-cases:
- SUC-002
- SUC-003
depends-on:
- '004'
github-issue: ''
todo: ''
---

# Migration — AuditEvent, ProvisioningRequest, and MergeSuggestion entities

## Description

Create the remaining three entity tables: `AuditEvent`, `ProvisioningRequest`,
and `MergeSuggestion`. These all depend on `User` (T003). This completes the
full schema migration — after this ticket all seven domain entity tables exist.

## Acceptance Criteria

- [x] `server/prisma/schema.prisma` defines:

  **AuditEvent:**
  - `id`, `actor_user_id` (nullable FK → User, SetNull on delete),
    `action` (string, NOT NULL), `target_user_id` (nullable FK → User,
    SetNull on delete), `target_entity_type` (optional string),
    `target_entity_id` (optional string), `details` (optional Json),
    `created_at`.
  - Named relations: `"AuditActor"` on `actor_user_id`, `"AuditTarget"`
    on `target_user_id`.
  - Indexes: `(actor_user_id, created_at)`, `(target_user_id, created_at)`,
    `(action, created_at)`.

  **ProvisioningRequest:**
  - `id`, `user_id` (FK → User, cascade delete), `requested_type` (enum:
    workspace/claude), `status` (enum: pending/approved/rejected, default
    pending), `decided_by` (nullable FK → User "DeciderUser", SetNull),
    `decided_at` (optional), `created_at`.
  - Indexes: `(user_id, status)`, `(status, created_at)`.

  **MergeSuggestion:**
  - `id`, `user_a_id` (FK → User "MergeUserA", cascade delete), `user_b_id`
    (FK → User "MergeUserB", cascade delete), `haiku_confidence` (Float),
    `haiku_rationale` (optional string), `status` (enum:
    pending/approved/rejected/deferred, default pending), `decided_by`
    (nullable FK → User "MergeDecider", SetNull), `decided_at` (optional),
    `created_at`.
  - Unique: `(user_a_id, user_b_id)`.
  - Index: `(status, created_at)`.

  **New enums:** `ProvisioningType`, `ProvisioningStatus`, `MergeStatus`.

- [x] `npx prisma migrate dev --name audit-provisioning-merge` generates and
      applies cleanly on fresh Postgres and SQLite databases.
- [x] `npx prisma generate` regenerates client without errors; exports all new
      model types and enums.
- [x] `npm run build` passes with no TypeScript errors.
- [x] Prisma enum emulation in SQLite (TEXT + CHECK constraint) is verified:
      inserting an invalid enum value for `MergeStatus` fails with a
      constraint error in the SQLite test DB.
- [x] `npm run test:server` passes.

## Implementation Plan

### Approach

Edit `schema.prisma` to add the three models and three new enums. The named
relations on `User` (`"AuditActor"`, `"AuditTarget"`, `"MergeUserA"`, etc.)
must be declared on both sides of the relation (on `AuditEvent` and on
`User`). Update the `User` model to add the corresponding relation arrays.

### Files to Modify

- `server/prisma/schema.prisma` — add `AuditEvent`, `ProvisioningRequest`,
  `MergeSuggestion`, and the three new enums. Add named relation arrays to
  `User`.

### SQLite Enum Verification

After migration, run:
```
DATABASE_URL=file:./data/test.db npx prisma migrate dev
```
Then manually attempt to insert a `MergeSuggestion` with an invalid `status`
value using `prisma.$executeRaw` to confirm the CHECK constraint fires.

### Testing Plan

- Apply migration on both databases; no errors expected.
- `npm run build` — no TypeScript errors.
- `npm run test:server` — existing tests pass.
- Manual enum constraint verification (described above).

### Documentation Updates

None beyond schema and migration files.
