---
id: "005"
title: "Server: GroupService.setPermission + addMember provisioning fan-out + PATCH endpoint"
status: todo
use-cases:
  - SUC-005
  - SUC-006
depends-on:
  - "002"
github-issue: ""
todo: ""
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: GroupService.setPermission + addMember provisioning fan-out + PATCH endpoint

## Description

Add `GroupService.setPermission(groupId, perm, value, actorId)` — updates one of the
three boolean permission flags on a Group and, when `perm === 'leagueAccount'` and
`value === true`, fans out Workspace account provisioning for every unprovisioned member.

Extend `GroupService.addMember` to trigger provisioning when the group has
`allowsLeagueAccount === true` and the user has no active Workspace ExternalAccount.

Add `PATCH /admin/groups/:id` endpoint to the admin groups router to expose these
operations via the API.

**Provisioning fan-out**: inline/synchronous for now (per the TODO "IMMEDIATE" directive).
All new Workspace accounts target `/Students` OU.

**Toggle-off rule**: toggling `allowsLeagueAccount` to `false` does NOT delete or suspend
existing Workspace accounts (grandfather).

## Acceptance Criteria

- [ ] `GroupService.setPermission(groupId, 'oauthClient' | 'llmProxy' | 'leagueAccount', boolean, actorId)` exists and updates the Group row.
- [ ] Calling `setPermission(groupId, 'leagueAccount', true, actorId)` fans out provisioning for every member who has no active Workspace ExternalAccount.
- [ ] Members who already have an active Workspace account are not reprovisioned.
- [ ] Calling `setPermission(groupId, 'leagueAccount', false, actorId)` does NOT delete or suspend existing Workspace accounts.
- [ ] `setPermission` for `oauthClient` or `llmProxy` does not trigger any provisioning.
- [ ] `GroupService.addMember` triggers Workspace provisioning for the new member when the group has `allowsLeagueAccount=true` and the user has no active Workspace account.
- [ ] `GroupService.addMember` does not trigger provisioning when `allowsLeagueAccount=false`.
- [ ] `PATCH /admin/groups/:id` endpoint exists; accepts `{ allowsOauthClient?, allowsLlmProxy?, allowsLeagueAccount? }`.
- [ ] `PATCH /admin/groups/:id` returns the updated group object including all three permission flags.
- [ ] `GET /admin/groups/:id` response is extended to include the three permission flags.
- [ ] Integration tests cover: setPermission for each flag; fan-out on leagueAccount=true; no fan-out on toggle-off; addMember provisioning; addMember no-provisioning when flag is false.

## Implementation Plan

### Approach

1. Add `setPermission` to `GroupService`. The method:
   - Updates the Group row via `GroupRepository.update` (or direct Prisma call).
   - When `perm === 'leagueAccount' && value === true`: fetches all group members via
     `GroupRepository.listMembers`, filters to those without an active Workspace
     ExternalAccount, then triggers provisioning for each. Use the existing provisioning
     path already available in the service registry (e.g., the same service used by
     `bulk-provision` on groups — `BulkAccountService` or `WorkspaceSyncService`).
   - Records an audit event.

2. Extend `GroupService.addMember`:
   - After adding the member, fetch the group's `allowsLeagueAccount` flag.
   - If `true`, check if the user has an active Workspace ExternalAccount.
   - If not, trigger provisioning.

3. Add `PATCH /admin/groups/:id` to `server/src/routes/admin/groups.ts`:
   - Accept `{ allowsOauthClient?, allowsLlmProxy?, allowsLeagueAccount? }`.
   - For each key present, call `GroupService.setPermission`.
   - Return the updated group object with permission flags.

4. Extend `GET /admin/groups/:id` serializer in `groups.ts` to include the three flags.

### Files to modify

- `server/src/services/group.service.ts` — add `setPermission`; extend `addMember`
- `server/src/routes/admin/groups.ts` — add PATCH endpoint; extend GET single serializer
- `server/src/services/repositories/group.repository.ts` — may need a `findByIdWithPermissions` or ensure `findById` returns new fields (auto after schema change)

### Testing plan

Integration tests in `tests/server/routes/admin/groups.test.ts` (or new file):
- PATCH `allowsOauthClient=true` → Group row updated, no provisioning triggered.
- PATCH `allowsLeagueAccount=true` → Group row updated; members without Workspace accounts get provisioned.
- PATCH `allowsLeagueAccount=false` → Group row updated; existing Workspace accounts unchanged.
- `addMember` to league-account group (user has no Workspace account) → provisioning initiated.
- `addMember` to non-league-account group → no provisioning.
- `addMember` when user already has active Workspace account → no duplicate provisioning.

### Documentation updates

None required.
