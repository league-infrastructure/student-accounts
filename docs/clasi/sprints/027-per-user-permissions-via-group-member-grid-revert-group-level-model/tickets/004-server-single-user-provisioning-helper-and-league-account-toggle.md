---
id: "004"
title: "Server: single-user provisioning helper and League Account toggle"
status: todo
use-cases:
  - SUC-004
depends-on:
  - "003"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: single-user provisioning helper and League Account toggle

## Description

Extract the per-user provisioning logic from `GroupService._provisionMembersWithoutWorkspace`
into a standalone helper function `provisionUserIfNeeded`. Wire this helper
into the `PATCH /admin/users/:id/permissions` handler (from ticket 003) so that
when `allows_league_account` transitions from `false` to `true`, the user is
immediately provisioned with a Workspace account in `/Students` (if they do not
already have one).

Also remove the provisioning side-effect from `GroupService.addMember`
(the `allows_league_account` check on the group row). The group no longer
carries that flag, so the side-effect is a dead code path.

## Acceptance Criteria

- [ ] A helper `provisionUserIfNeeded(prisma, workspaceProvisioning, userId, actorId)` exists (in `group.service.ts` or a shared helper module).
- [ ] Helper checks for an active/pending workspace `ExternalAccount` for the user; skips provisioning if found.
- [ ] Helper calls `workspaceProvisioning.provision(userId, actorId, tx)` inside a `prisma.$transaction` when provisioning is needed.
- [ ] Helper is fail-soft: provisioning errors are logged but do not propagate or affect the HTTP response.
- [ ] `PATCH /admin/users/:id/permissions` handler calls `provisionUserIfNeeded` when `allows_league_account` transitions to `true` (previous value was `false`).
- [ ] `GroupService.addMember` no longer checks `group.allows_league_account` or triggers provisioning.
- [ ] `GroupService._provisionMembersWithoutWorkspace` is deleted (its logic is now in the helper).
- [ ] `GroupService` constructor: `workspaceProvisioning` optional dep is removed if `addMember` no longer uses it (assess during implementation).

## Implementation Plan

### Approach

1. Extract `provisionUserIfNeeded` from `_provisionMembersWithoutWorkspace`
   in `group.service.ts`. The logic is:
   - Fetch `ExternalAccountRepository.findActiveByUserAndType(prisma, userId, 'workspace')`.
   - If found, return early.
   - Otherwise: `await prisma.$transaction(tx => workspaceProvisioning.provision(userId, actorId, tx))`.
   - Wrap in try/catch; log error on failure.
2. Delete `_provisionMembersWithoutWorkspace` and the `setPermission` fan-out
   call (ticket 005 deletes `setPermission` itself).
3. Remove the `allows_league_account` side-effect block from `addMember`.
4. In `users.ts`, read the previous value of `allows_league_account` before
   the transaction, then after committing, conditionally call
   `provisionUserIfNeeded` if the flag flipped to `true`.

### Files to Modify

- `server/src/services/group.service.ts` — extract helper, remove `addMember` provisioning side-effect, delete `_provisionMembersWithoutWorkspace`.
- `server/src/routes/admin/users.ts` — wire `provisionUserIfNeeded` into the permissions PATCH handler.
- `server/src/services/external-account.repository.ts` (or equivalent) — confirm `findActiveByUserAndType` exists; use it.

### Testing Plan

- Unit test `provisionUserIfNeeded`:
  - User already has workspace account → provisioning not called.
  - User has no workspace account → `provision` called once.
  - `provision` throws → error logged, no exception propagated.
- Route test: `PATCH /api/admin/users/:id/permissions { allows_league_account: true }` → provisioning fired (mock `workspaceProvisioning`).
- Route test: `PATCH /api/admin/users/:id/permissions { allows_league_account: false }` → provisioning not fired.
- Route test: provisioning fails → 200 still returned (fail-soft).
- Verify `addMember` tests do not expect provisioning.
- Run `npm run test:server`.

### Documentation Updates

None required.
