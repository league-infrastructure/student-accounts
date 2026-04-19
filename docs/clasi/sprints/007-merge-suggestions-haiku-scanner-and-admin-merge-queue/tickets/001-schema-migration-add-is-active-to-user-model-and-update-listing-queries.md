---
id: "001"
title: "Schema migration — add is_active to User model and update listing queries"
status: todo
use-cases: [SUC-007-004]
depends-on: []
github-issue: ""
todo: ""
---

# Schema migration — add is_active to User model and update listing queries

## Description

Add `is_active Boolean @default(true)` to the `User` model in `schema.prisma`.
Run `prisma db push` (dev) to apply the change. Audit all `prisma.user.findMany`
and `UserRepository` list methods and add `where: { is_active: true }` as the
default filter. Add a `findByIdIncludingInactive(id)` method (or option flag)
to `UserService` / `UserRepository` so admin detail routes can still fetch
deactivated users by ID.

This is a foundation ticket. All other tickets in this sprint depend on the
`is_active` field being present before merge operations can deactivate users.

## Acceptance Criteria

- [ ] `User` model in `schema.prisma` has `is_active Boolean @default(true)`.
- [ ] `prisma db push` (dev) succeeds; all existing users have `is_active = true`.
- [ ] `UserRepository.findAll()` / `UserService.findAll()` filters `is_active = true`
      by default.
- [ ] `UserRepository.findById()` returns null for inactive users.
- [ ] A new `findByIdIncludingInactive(id)` method or `{ includeInactive: true }`
      option exists to fetch inactive users for admin views.
- [ ] All existing tests continue to pass.

## Implementation Plan

### Approach

1. Edit `server/prisma/schema.prisma`: add `is_active Boolean @default(true)` to
   the `User` model block.
2. Run `npx prisma db push` in the server directory to apply to dev SQLite.
3. Grep for `prisma.user.findMany` and `UserRepository` list methods across
   `server/src/`. Add `where: { is_active: true }` to each unless already filtered.
4. In `server/src/services/repositories/user.repository.ts`, add
   `findByIdIncludingInactive(db, id)` as a new static method.
5. In `server/src/services/user.service.ts`, expose `findByIdIncludingInactive(id)`.

### Files to Create/Modify

- `server/prisma/schema.prisma` — add `is_active` field
- `server/src/services/repositories/user.repository.ts` — update `findAll`, add
  `findByIdIncludingInactive`
- `server/src/services/user.service.ts` — update `findAll`, add
  `findByIdIncludingInactive`
- Any route files that call `prisma.user.findMany` directly (audit during
  implementation)

### Testing Plan

- Run `npm test` from the project root to verify no regressions in existing
  user-related tests.
- Write a DB-layer test in `tests/db/` that creates a user, sets `is_active=false`,
  and verifies `UserRepository.findAll()` excludes it but
  `findByIdIncludingInactive()` returns it.

### Documentation Updates

None required — schema change is self-documenting.
