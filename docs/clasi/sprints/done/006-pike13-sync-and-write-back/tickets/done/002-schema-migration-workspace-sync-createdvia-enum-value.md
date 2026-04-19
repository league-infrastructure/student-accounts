---
id: '002'
title: 'Schema migration: workspace_sync CreatedVia enum value'
status: done
use-cases:
- SUC-002
- SUC-003
depends-on: []
github-issue: ''
todo: ''
---

# Schema migration: workspace_sync CreatedVia enum value

## Description

Add `workspace_sync` to the `CreatedVia` enum in `server/prisma/schema.prisma`
and generate the corresponding Prisma migration. This value is required by
`WorkspaceSyncService` when creating User rows from Workspace data (SUC-002
staff sync and SUC-003 student sync).

This is an additive, backward-compatible change. No existing rows are affected.
Run `prisma db push` in dev (dev DB is disposable) rather than `prisma migrate dev`.

## Acceptance Criteria

- [x] `CreatedVia` enum in `schema.prisma` includes `workspace_sync`.
- [x] `npx prisma generate` succeeds.
- [x] `npx prisma db push` (dev) or `npx prisma migrate dev` applies the change
  without errors on both SQLite and PostgreSQL.
- [x] TypeScript compiles cleanly with the new enum value in scope.
- [x] Existing tests continue to pass (no regressions).

## Implementation Plan

### Approach

1. Edit `server/prisma/schema.prisma`: add `workspace_sync` to `CreatedVia`.
2. Run `npx prisma db push` in dev to apply to the local SQLite DB.
3. Regenerate the Prisma client (`npx prisma generate`).
4. Confirm TypeScript compilation passes.

### Files to Modify

- `server/prisma/schema.prisma` — add `workspace_sync` to `CreatedVia` enum

### Testing Plan

- Run the existing test suite to confirm no regressions after the schema change.
- No new tests required for this ticket (the migration itself is trivial).

### Documentation Updates

- None. The architecture update already documents this change.
