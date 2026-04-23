---
id: '011'
title: AnthropicSyncService and ExternalAccountLifecycleService real Claude ops
status: done
use-cases:
  - SUC-010-006
depends-on:
  - "010-008"
github-issue: ''
todo: plan-claude-team-account-management-real-admin-api-integration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# AnthropicSyncService and ExternalAccountLifecycleService real Claude ops

## Description

Two service implementations that require `AnthropicAdminClient` (T008) to be
wired into the `ServiceRegistry` first:

1. **`AnthropicSyncService`**: Reconciles Anthropic org state against local
   `ExternalAccount` rows. Handles: link by email for existing org users,
   invite-accepted transitions (pending → active + workspace add), and
   removal of stale records.

2. **`ExternalAccountLifecycleService` real Claude ops**: The existing Claude
   `suspendMember` was a no-op (OQ-003, Sprint 005). Implement real suspend
   (workspace-revoke) and real remove (org-delete) using `AnthropicAdminClient`.

Also update `ClaudeProvisioningService.provision()` to use the real invite flow
(was previously calling the fake endpoint).

## Acceptance Criteria

**AnthropicSyncService:**
- [x] `server/src/services/anthropic/anthropic-sync.service.ts` created.
- [x] `reconcile()` method: fetches all org users (paginated), all invites (paginated).
- [x] For each org user whose email matches a local User (case-insensitive) and who has no `type=claude` ExternalAccount: creates `ExternalAccount(type='claude', status='active', external_id=<anthropic user id>)`.
- [x] For each pending invite in the API: finds the local `ExternalAccount` with `external_id=<invite id>`. If the invite email now appears in org users list: transitions to `active`, rewrites `external_id` to org user id, calls `addUserToWorkspace(studentsWorkspaceId, userId)`.
- [x] For each local `type=claude` ExternalAccount whose `external_id` is absent from both the org users list and the invites list: transitions to `removed`, emits `claude_sync_flagged` AuditEvent.
- [x] Returns `SyncReport { created: number; linked: number; invitedAccepted: number; removed: number; unmatched: string[] }`.
- [x] Students workspace ID resolved once per process from `CLAUDE_STUDENT_WORKSPACE` env var (default `"Students"`), cached.
- [x] `ServiceRegistry` gains `readonly anthropicSync: AnthropicSyncService`.

**ExternalAccountLifecycleService:**
- [x] Claude `suspend()`: calls `AnthropicAdminClient.removeUserFromWorkspace(studentsWorkspaceId, externalId)`. Status → `suspended`. Existing audit event emitted.
- [x] Claude `remove()`: calls `AnthropicAdminClient.deleteOrgUser(externalId)`. Status → `removed`. Existing audit event emitted.
- [x] Existing workspace (Google) suspend/remove paths unchanged.

**ClaudeProvisioningService:**
- [x] `provision()`: calls `AnthropicAdminClient.inviteToOrg({ email: leagueEmail })`. Creates ExternalAccount with `status='pending'`, `external_id=<invite id>`.
- [x] Existing `WorkspaceProvisioningService` prerequisite check unchanged.

**Tests:**
- [x] `AnthropicSyncService` scenario tests using `FakeAnthropicAdminClient`:
  - 3 org users, 1 matching local user → creates 1 link, 2 unmatched.
  - Pending invite accepted → ExternalAccount transitions active, `addUserToWorkspace` called.
  - Local claude ExternalAccount with unknown external_id → transitions to removed.
- [x] `ExternalAccountLifecycleService` updated tests: Claude suspend calls workspace-revoke; Claude remove calls org-delete.
- [x] `ClaudeProvisioningService` updated tests: provision calls `inviteToOrg`, not old `inviteMember`.
- [x] `npm run test:server` passes.

## Implementation Plan

### New Files

**`server/src/services/anthropic/anthropic-sync.service.ts`**

Constructor takes `AnthropicAdminClient`, `PrismaClient`, `AuditService`.
- `resolveStudentsWorkspace()` — cached helper, calls `listWorkspaces()`, finds by name.
- `reconcile()` — fetch org users (paginate until `nextCursor` is null), fetch invites (same), then run three reconciliation passes.

### Files to Modify

**`server/src/services/external-account-lifecycle.service.ts`**
- In `suspendAccount()` for `type=claude`: replace no-op log with `await anthropicClient.removeUserFromWorkspace(studentsWsId, externalId)`.
- In `removeAccount()` for `type=claude`: replace existing call with `await anthropicClient.deleteOrgUser(externalId)`.
- Constructor: replace `ClaudeTeamAdminClient` param type with `AnthropicAdminClient`.

**`server/src/services/claude-provisioning.service.ts`**
- `provision()`: call `anthropicClient.inviteToOrg({ email })` instead of old `inviteMember`.
- Create ExternalAccount with `status='pending'`, `external_id=invite.id`.

**`server/src/services/service.registry.ts`**
- Add `readonly anthropicSync: AnthropicSyncService`.
- Instantiate in constructor after `anthropicAdmin`.

### Testing Plan

All tests via `npm run test:server`. Use `FakeAnthropicAdminClient` from T008
to avoid real API calls. Seed `_users`, `_invites`, `_workspaces` on the fake
before each scenario.
