---
id: '001'
title: 'Schema: move permission flags from Group to User'
status: done
use-cases:
- SUC-001
depends-on: []
todo: per-user-permissions-via-group-grid.md
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Schema: move permission flags from Group to User

## Description

Sprint 026 added three boolean columns to `Group`:
`allows_oauth_client`, `allows_llm_proxy`, `allows_league_account`.
This sprint moves those columns to `User` (all `@default(false)`) and
drops them from `Group`. No data migration is needed because group flags
were never set in production.

## Acceptance Criteria

- [x] `server/prisma/schema.prisma` — `model User` has `allows_oauth_client Boolean @default(false)`, `allows_llm_proxy Boolean @default(false)`, `allows_league_account Boolean @default(false)`.
- [x] `server/prisma/schema.prisma` — `model Group` does NOT have `allows_oauth_client`, `allows_llm_proxy`, or `allows_league_account`.
- [x] `prisma db push` succeeds against the dev database (no migration file needed in dev).
- [x] The Prisma client regenerates without errors.

## Implementation Plan

### Approach

Edit `schema.prisma` directly. Remove the three fields from `model Group` and
add them to `model User` with `@default(false)`. Run `prisma db push` to apply
to dev.

### Files to Modify

- `server/prisma/schema.prisma` — remove three fields from `Group`, add three fields to `User`.

### Testing Plan

- Run `npm run test:server` to confirm no existing server tests fail from schema
  changes (some tests that reference group permission columns will fail — that is
  expected and will be fixed in later tickets).
- Confirm `prisma db push` exits 0.

### Documentation Updates

None required for this ticket.
