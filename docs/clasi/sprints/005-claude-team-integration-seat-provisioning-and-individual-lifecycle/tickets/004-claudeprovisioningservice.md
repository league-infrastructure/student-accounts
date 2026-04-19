---
id: "004"
title: "ClaudeProvisioningService"
status: todo
use-cases: [SUC-001]
depends-on: ["001", "002"]
---

# ClaudeProvisioningService

## Description

Implement `ClaudeProvisioningService` — the service that handles Claude Team
seat provisioning for one user. This service mirrors `WorkspaceProvisioningService`
structurally:
- Validates preconditions (active workspace ExternalAccount exists, no active/pending claude account).
- Calls `ClaudeTeamAdminClient.inviteMember` with the user's League Workspace email.
- Creates the `ExternalAccount` row (type=claude, status=active, external_id=member.id).
- Emits the audit event (action=provision_claude).
- The caller supplies the Prisma transaction client (`tx`).

Register the service in `ServiceRegistry`.

## Acceptance Criteria

- [ ] `server/src/services/claude-provisioning.service.ts` created.
- [ ] `provision(userId, actorId, tx)` validates active workspace account exists; throws UnprocessableError (422) if not.
- [ ] `provision` validates no active/pending claude ExternalAccount exists; throws ConflictError (409) if already provisioned.
- [ ] `provision` calls `ClaudeTeamAdminClient.inviteMember` with the workspace email (not the primary email).
- [ ] ExternalAccount created: type=claude, status=active, external_id=member id from API.
- [ ] AuditEvent recorded inside tx: action=provision_claude, actor_user_id=actorId, target_user_id=userId.
- [ ] `ServiceRegistry` updated to instantiate and expose `claudeProvisioning`.
- [ ] Integration tests pass (see Testing Plan).

## Implementation Plan

### Approach

1. Create `server/src/services/claude-provisioning.service.ts`.
2. Constructor receives: `googleAdminClient` (to look up workspace email from
   ExternalAccount), `claudeTeamClient`, `externalAccountRepo`,
   `userRepo`, `auditService`.
3. `provision(userId, actorId, tx)`:
   a. Load user record to verify role=student.
   b. Find active workspace ExternalAccount; extract `external_id` (Workspace
      user email).
   c. Check no active/pending claude ExternalAccount exists.
   d. Call `claudeTeamClient.inviteMember({ email: workspaceEmail })`.
   e. Create ExternalAccount via `externalAccountRepo.create(tx, ...)`.
   f. Call `auditService.record(tx, ...)`.
4. Add to `ServiceRegistry`: inject `ClaudeTeamAdminClient` alongside existing
   `GoogleWorkspaceAdminClient`.

### Files to create/modify

- `server/src/services/claude-provisioning.service.ts` (new)
- `server/src/services/service.registry.ts` (add claudeProvisioning)

### Testing plan

Integration tests in `tests/server/services/claude-provisioning.service.test.ts`:
- Success: provision creates ExternalAccount and audit event, inviteMember called with workspace email.
- No active workspace account: UnprocessableError, no API call.
- Claude account already exists: ConflictError, no API call.
- API failure: no ExternalAccount created (transaction rollback verified).

Use `FakeClaudeTeamAdminClient` from T002.

### Documentation updates

None.
