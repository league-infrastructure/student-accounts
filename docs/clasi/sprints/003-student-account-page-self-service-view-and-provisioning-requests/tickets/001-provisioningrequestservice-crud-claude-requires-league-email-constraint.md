---
id: '001'
title: 'ProvisioningRequestService: CRUD + Claude-requires-League-email constraint'
status: done
use-cases:
- SUC-004
- SUC-005
depends-on: []
github-issue: ''
todo: ''
---

# ProvisioningRequestService: CRUD + Claude-requires-League-email constraint

## Description

Sprint 001 left `ProvisioningRequestService` as a stub with only `findPending`
and `findByUser`. This ticket fleshes it out with the full set of methods
needed for Sprint 003 and provides seams for Sprint 004 (administrator
approval/rejection).

The critical business rule enforced here is: a student cannot obtain a Claude
Team seat without a League email. The service must check this constraint
server-side, inside the same transaction as the write, so UI bypass is not
possible.

## Acceptance Criteria

- [x] `ProvisioningRequestService.create(userId, requestType, actorId)` creates
      a pending ProvisioningRequest (or two, for `workspace_and_claude`).
- [x] `create` with `requestType='workspace'` returns a single ProvisioningRequest
      row with `requested_type='workspace'` and `status='pending'`.
- [x] `create` with `requestType='workspace_and_claude'` returns two rows:
      one `type=workspace` and one `type=claude`, both `status='pending'`,
      created atomically in one transaction.
- [x] `create` returns a ConflictError (409) if the user already has a pending
      or active ExternalAccount of type=workspace, OR a ProvisioningRequest
      of type=workspace in status pending/approved, when requestType includes
      workspace.
- [x] `create` returns an UnprocessableError (422) if requestType would include
      a claude request but the user has neither a pending/active workspace
      ExternalAccount nor a pending/approved workspace ProvisioningRequest.
- [x] `create` records a `create_provisioning_request` AuditEvent for each
      ProvisioningRequest created, atomically within the same transaction.
- [x] `approve(requestId, deciderId)` sets status=approved, decided_by,
      decided_at, records `approve_provisioning_request` AuditEvent. (Seam —
      no external API calls.)
- [x] `reject(requestId, deciderId)` sets status=rejected, decided_by,
      decided_at, records `reject_provisioning_request` AuditEvent. (Seam.)
- [x] `findByUser(userId)` returns all ProvisioningRequests for the user,
      ordered by created_at desc.
- [x] `findPending()` returns all ProvisioningRequests with status=pending,
      ordered by created_at asc.
- [x] A `notifyAdmin` hook is called after the transaction commits in `create`
      but is a no-op this sprint (logs a message; Sprint 004+ will implement).
- [x] Integration tests cover all constraint scenarios listed above.

## Implementation Plan

### Approach

Extend `server/src/services/provisioning-request.service.ts`. Add
`ExternalAccountService` as a constructor dependency (or accept its repository
directly) to check the workspace constraint. All writes go through
`prisma.$transaction` with AuditService.record inside the same tx.

### Files to Modify

- `server/src/services/provisioning-request.service.ts` — primary change
- `server/src/services/service.registry.ts` — pass ExternalAccountService
  (or its repo) as dependency when constructing ProvisioningRequestService
- `server/src/errors.ts` — add `UnprocessableError` class if not present

### Files to Create

- `tests/server/services/provisioning-request.service.test.ts` — integration
  tests using the real SQLite test DB and factory helpers

### Testing Plan

All tests use the real SQLite DB. Use factory helpers to set up preconditions.

Test cases:
1. `create('workspace')` — happy path: one row created, audit recorded.
2. `create('workspace')` — conflict: user already has pending workspace request.
3. `create('workspace')` — conflict: user has active workspace ExternalAccount.
4. `create('workspace_and_claude')` — happy path: two rows created atomically.
5. `create('workspace_and_claude')` — claude constraint: no existing workspace
   baseline → 422.
6. `create('workspace_and_claude')` — constraint satisfied by pending workspace
   ProvisioningRequest → succeeds.
7. `create('workspace_and_claude')` — constraint satisfied by active workspace
   ExternalAccount → succeeds.
8. `approve` — sets status, decided_by, audit recorded.
9. `reject` — sets status, decided_by, audit recorded.
10. `findByUser` — returns correct rows for user.
11. Atomicity: verify that if AuditService.record throws, the ProvisioningRequest
    rows are not written (roll back test).

### Documentation Updates

Update the Sprint 003 architecture-update.md status to confirmed after
implementation verifies the constraint behavior matches the spec.
