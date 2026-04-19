---
id: "005"
title: "ExternalAccountLifecycleService (suspend and remove)"
status: todo
use-cases: [SUC-004, SUC-005, SUC-006]
depends-on: ["001", "002"]
---

# ExternalAccountLifecycleService (suspend and remove)

## Description

Implement `ExternalAccountLifecycleService` — the service that routes suspend
and remove operations on individual ExternalAccount records to the appropriate
external API (Google Workspace or Claude Team) and then updates the row.

**suspend(accountId, actorId, tx):**
- For workspace: calls `GoogleWorkspaceAdminClient.suspendUser(email)`.
- For claude: calls `ClaudeTeamAdminClient.suspendMember(externalId)`. If the
  Claude API does not support suspend (OQ-003), log a warning and skip the API
  call but still update status (or reject the operation — see implementation note).
- Updates ExternalAccount: status=suspended, status_changed_at=now.
- Emits audit event (suspend_workspace or suspend_claude).

**remove(accountId, actorId, tx):**
- For workspace: calls suspendUser if not already suspended, then sets
  scheduled_delete_at = now + WORKSPACE_DELETE_DELAY_DAYS (default 3).
- For claude: calls `ClaudeTeamAdminClient.removeMember(externalId)`.
- Updates ExternalAccount: status=removed, status_changed_at=now.
- Emits audit event (remove_workspace or remove_claude).

Both methods throw NotFoundError if the account does not exist and
UnprocessableError if the current status is already removed.

Register in `ServiceRegistry`.

## Acceptance Criteria

- [ ] `server/src/services/external-account-lifecycle.service.ts` created.
- [ ] `suspend`: workspace calls suspendUser; claude calls suspendMember (or handles OQ-003 gracefully).
- [ ] `suspend`: ExternalAccount.status=suspended, status_changed_at set.
- [ ] `suspend`: correct audit action string (suspend_workspace vs suspend_claude).
- [ ] `remove` (workspace): suspends if not already suspended, sets scheduled_delete_at.
- [ ] `remove` (workspace): ExternalAccount.status=removed immediately.
- [ ] `remove` (claude): calls removeMember, ExternalAccount.status=removed.
- [ ] `remove`: correct audit action string (remove_workspace vs remove_claude).
- [ ] WORKSPACE_DELETE_DELAY_DAYS env var controls the delay (default 3).
- [ ] NotFoundError thrown when accountId does not exist.
- [ ] UnprocessableError thrown when account is already in status=removed.
- [ ] `ServiceRegistry` updated.
- [ ] Integration tests pass.

## Implementation Plan

### Approach

1. Create `server/src/services/external-account-lifecycle.service.ts`.
2. Constructor receives: `googleClient`, `claudeTeamClient`, `externalAccountRepo`, `auditService`.
3. Implement `suspend` and `remove` methods with the routing logic described above.
4. For `remove` (workspace): compute `scheduledDeleteAt = new Date(Date.now() + delayDays * 86400000)`.
   Use `externalAccountRepo.update(tx, accountId, { status: 'removed', status_changed_at: new Date(), scheduled_delete_at: scheduledDeleteAt })`.
5. Register in ServiceRegistry.

### Files to create/modify

- `server/src/services/external-account-lifecycle.service.ts` (new)
- `server/src/services/service.registry.ts` (add externalAccountLifecycle)
- `server/src/services/repositories/external-account.repository.ts` (add `update` method if not present)

### Testing plan

Integration tests in `tests/server/services/external-account-lifecycle.service.test.ts`:
- suspend workspace: suspendUser called, status=suspended, audit event.
- suspend claude: suspendMember called (or OQ-003 path), status=suspended, audit event.
- suspend already-suspended: UnprocessableError.
- remove workspace: suspendUser called (if active), scheduled_delete_at set, status=removed, audit event.
- remove workspace (already suspended): suspendUser NOT called, status=removed.
- remove claude: removeMember called, status=removed, audit event.
- remove already-removed: UnprocessableError.

### Documentation updates

Add `WORKSPACE_DELETE_DELAY_DAYS` to `config/dev/public.env` (non-secret, default 3) and its example files.
