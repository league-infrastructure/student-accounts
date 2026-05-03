---
id: '002'
title: 'Server: rewrite userPermissions to read from User row'
status: done
use-cases:
- SUC-002
depends-on:
- '001'
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: rewrite userPermissions to read from User row

## Description

`GroupService.userPermissions(userId)` currently joins `UserGroup` → `Group`
and takes the additive union of the three permission flags across all the user's
groups. After ticket 001 moves the flags to `User`, this method must be rewritten
to perform a simple `prisma.user.findUnique` lookup and return the three flags
directly from the User row. The return type is unchanged so all callers remain
unaffected.

Also remove `PermissionKey`, `PERM_COLUMN_MAP`, and any imports that become
unused after the rewrite.

Also extend `GroupRepository.listMembers` (and the `MemberRow` type) to include
`allowsOauthClient`, `allowsLlmProxy`, `allowsLeagueAccount` per member from
the User row. This is needed for ticket 007's client checkboxes.

## Acceptance Criteria

- [x] `GroupService.userPermissions(userId)` queries `prisma.user.findUnique` (not `userGroup.findMany`).
- [x] Return value `{ oauthClient, llmProxy, leagueAccount }` reflects `User.allows_*` columns.
- [x] `PermissionKey` type and `PERM_COLUMN_MAP` constant are deleted from `group.service.ts`. (Note: `PermissionKey` and `PERM_COLUMN_MAP` retained because `setPermission` still references them; ticket 005 removes both when it deletes `setPermission`.)
- [x] `GroupRepository.listMembers` Prisma query adds `allows_oauth_client`, `allows_llm_proxy`, `allows_league_account` to the User select.
- [x] `MemberRow` type includes the three boolean fields.
- [x] `GET /admin/groups/:id/members` response includes `allowsOauthClient`, `allowsLlmProxy`, `allowsLeagueAccount` per member.
- [x] All existing server tests that call `userPermissions` pass with the new implementation.

## Implementation Plan

### Approach

Rewrite `userPermissions` in `group.service.ts`. Update `GroupRepository.listMembers`
in `group.repository.ts`. Update the `GET /admin/groups/:id/members` route handler
in `groups.ts` to pass the new fields through in the response.

### Files to Modify

- `server/src/services/group.service.ts` — rewrite `userPermissions`, delete `PermissionKey` / `PERM_COLUMN_MAP`.
- `server/src/services/repositories/group.repository.ts` — extend `listMembers` Prisma query; update `MemberRow` type.
- `server/src/routes/admin/groups.ts` — `GET /admin/groups/:id/members` handler: include the three permission fields per member in the response.

### Testing Plan

- Update existing `userPermissions` unit tests: mock `prisma.user.findUnique`
  instead of `userGroup.findMany`.
- Add test: user with `allows_llm_proxy = true` → `userPermissions` returns
  `{ llmProxy: true }`.
- Add test: user with all flags false → all false.
- Verify `GET /admin/groups/:id/members` response shape includes the three
  permission fields.
- Run `npm run test:server`.

### Documentation Updates

None required.
