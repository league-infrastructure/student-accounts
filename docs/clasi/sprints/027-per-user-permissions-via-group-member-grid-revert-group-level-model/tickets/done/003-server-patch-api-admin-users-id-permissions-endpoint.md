---
id: '003'
title: 'Server: PATCH /api/admin/users/:id/permissions endpoint'
status: done
use-cases:
- SUC-003
depends-on:
- '001'
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: PATCH /api/admin/users/:id/permissions endpoint

## Description

Add `PATCH /admin/users/:id/permissions` to `server/src/routes/admin/users.ts`.
This endpoint accepts a partial update of the user's three permission flags and
persists them to the User row. It records an audit event and emits change
notifications. The League Account provisioning side-effect lives in ticket 004
and is wired into this handler there.

## Acceptance Criteria

- [x] `PATCH /admin/users/:id/permissions` is mounted and reachable.
- [x] Body fields `allows_oauth_client`, `allows_llm_proxy`, `allows_league_account` are all optional booleans; any combination may be present.
- [x] Returns 400 if any provided field is not a boolean.
- [x] Returns 404 if the user does not exist.
- [x] Returns 200 with `{ allowsOauthClient, allowsLlmProxy, allowsLeagueAccount }` on success.
- [x] If body is empty (no recognized fields), returns 200 with current permission state (no-op).
- [x] An audit event `user_permission_changed` is recorded in the same transaction as the User row update.
- [x] `adminBus.notify('users')` and `userBus.notifyUser(id)` are emitted on successful update.

## Implementation Plan

### Approach

Add the route handler at the bottom of `adminUsersRouter` in `users.ts`.
Use `prisma.$transaction` to update the User row and write the audit event
atomically. Read the updated row and return the permission shape. Keep
provisioning logic out of this ticket — ticket 004 adds it as a post-commit
side-effect.

### Files to Modify

- `server/src/routes/admin/users.ts` — add `PATCH /users/:id/permissions` handler.

### Testing Plan

- New test file or new `describe` block in `tests/server/routes/admin/users.test.ts`:
  - PATCH with `{ allows_llm_proxy: true }` → 200, flag updated in DB.
  - PATCH with `{}` (empty body) → 200, no DB change.
  - PATCH with `{ allows_llm_proxy: "yes" }` (wrong type) → 400.
  - PATCH with unknown user id → 404.
  - Verify audit event is written.
- Run `npm run test:server`.

### Documentation Updates

None required.
