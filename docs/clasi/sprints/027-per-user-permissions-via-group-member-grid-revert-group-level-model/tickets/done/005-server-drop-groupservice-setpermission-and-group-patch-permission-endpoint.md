---
id: '005'
title: 'Server: drop GroupService.setPermission and group PATCH permission endpoint'
status: done
use-cases:
- SUC-006
depends-on:
- '002'
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: drop GroupService.setPermission and group PATCH permission endpoint

## Description

`GroupService.setPermission` was added in sprint 026 to update a group's
permission flags. Now that permission flags live on User (not Group), this
method is dead code. Delete it. Also:

- Remove the `PATCH /admin/groups/:id` route handler entirely (it only
  served permission flag updates).
- Remove `allowsOauthClient`, `allowsLlmProxy`, `allowsLeagueAccount` from the
  `GET /admin/groups/:id` response (the Group row no longer has these columns).
- Remove any now-unused imports in `group.service.ts` (e.g.,
  `WorkspaceProvisioningService` if `addMember` no longer uses it after ticket 004).

## Acceptance Criteria

- [x] `GroupService.setPermission` method is deleted from `group.service.ts`.
- [x] `PermissionKey` type (if not already deleted in ticket 002) is deleted.
- [x] `PERM_COLUMN_MAP` constant (if not already deleted in ticket 002) is deleted.
- [x] `PATCH /admin/groups/:id` route is removed from `groups.ts`.
- [x] `GET /admin/groups/:id` response no longer includes `allowsOauthClient`, `allowsLlmProxy`, or `allowsLeagueAccount`.
- [x] Any sprint 026 tests that tested `setPermission` or the group PATCH endpoint are deleted.
- [x] All remaining server tests pass (`npm run test:server`).

## Implementation Plan

### Approach

1. Delete `setPermission` from `group.service.ts` (and `PermissionKey`,
   `PERM_COLUMN_MAP` if ticket 002 left them).
2. Delete the `adminGroupsRouter.patch('/groups/:id', ...)` handler block
   from `groups.ts`.
3. In `groups.ts`, edit the `GET /admin/groups/:id` handler to remove the
   three permission fields from the response object.
4. Delete or update associated tests.

### Files to Modify

- `server/src/services/group.service.ts` — delete `setPermission`, remaining sprint 026 types.
- `server/src/routes/admin/groups.ts` — delete `PATCH /groups/:id` handler; update `GET /groups/:id` response.
- `tests/server/routes/admin/groups.test.ts` (or wherever sprint 026 PATCH tests live) — delete tests for group permission PATCH.
- `tests/server/services/group.service.test.ts` (or similar) — delete tests for `setPermission`.

### Testing Plan

- Run `npm run test:server` — all tests pass (sprint 026 tests for `setPermission`
  and group PATCH are deleted).
- Verify `GET /admin/groups/:id` response shape does not include permission fields.

### Documentation Updates

None required.
