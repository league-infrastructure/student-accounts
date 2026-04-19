---
id: "007"
title: "ProvisioningRequestService.approve wired to WorkspaceProvisioningService — approval triggers provision"
status: todo
use-cases: [UC-005]
depends-on: ["004"]
github-issue: ""
todo: ""
---

# ProvisioningRequestService.approve wired to WorkspaceProvisioningService — approval triggers provision

## Description

Sprint 003 left `ProvisioningRequestService.approve` as a seam: it sets
`status=approved` and records the `approve_provisioning_request` AuditEvent.
It does not call any external API or create any ExternalAccount.

This ticket extends `approve` to call `WorkspaceProvisioningService.provision`
inside the same transaction, so that approval of a workspace request immediately
provisions the account.

The extension is routing-logic only: `approve` inspects `request.requested_type`
and, if it is `'workspace'`, calls `WorkspaceProvisioningService.provision`.
For `'claude'` requests, it remains a pure status update (Sprint 005 will
extend it further).

`WorkspaceProvisioningService` is injected as a new constructor dependency on
`ProvisioningRequestService`.

## Acceptance Criteria

- [ ] `ProvisioningRequestService` constructor updated to accept
      `workspaceProvisioningService: WorkspaceProvisioningService` as an
      optional parameter (required when approve is called for workspace requests).
- [ ] `ServiceRegistry` updated to pass `WorkspaceProvisioningService` to
      `ProvisioningRequestService`.
- [ ] `approve(requestId: number, deciderId: number): Promise<ProvisioningRequest>`
      extended:
      - Fetches the ProvisioningRequest by `requestId`. Throws `NotFoundError`
        if absent. Throws `ConflictError` if status is not `'pending'`.
      - Opens `prisma.$transaction`:
        - Sets `request.status = 'approved'`, `decided_by = deciderId`,
          `decided_at = now()`.
        - Records `approve_provisioning_request` AuditEvent.
        - If `request.requested_type === 'workspace'`:
          calls `workspaceProvisioningService.provision(request.user_id, deciderId, tx)`.
        - Commits.
      - Returns the updated ProvisioningRequest.
- [ ] If `WorkspaceProvisioningService.provision` throws (SDK error, precondition
      fail, domain guard, etc.): the entire transaction is rolled back —
      `status` stays `'pending'`, no AuditEvent written, no ExternalAccount created.
      The error propagates to the caller.
- [ ] `reject` is unchanged from Sprint 003.
- [ ] Existing Sprint 003 tests for `approve` (status change, audit event)
      continue to pass. They use a provisioning request where `workspaceProvisioningService`
      is either mocked or the `FakeGoogleWorkspaceAdminClient` returns success.
- [ ] `npm test` passes.

## Implementation Plan

### Approach

Inject `WorkspaceProvisioningService` as an optional constructor parameter
(matches the Sprint 003 pattern where `ExternalAccountService` was injected).
Extend `approve` with a type-based routing branch. The transaction boundary
is already owned by `approve`; adding the `provision` call inside it is
straightforward.

### Files to Modify

- `server/src/services/provisioning-request.service.ts` — extend `approve`,
  update constructor.
- `server/src/services/service.registry.ts` — wire dependency.

### Testing Plan

Unit tests for the wiring logic (not end-to-end provisioning — that is T010):
- `approve` with `requested_type='workspace'`, `FakeGoogleWorkspaceAdminClient`
  returning success → request status=approved, ExternalAccount created.
- `approve` with `requested_type='workspace'`, fake throwing
  `WorkspaceApiError` → transaction rolled back, request still pending.
- `approve` with `requested_type='claude'` → status=approved, no provision
  call made (provision is for Sprint 005).
- `approve` on non-pending request → `ConflictError`.
- `reject` → status=rejected, no provision call.

### Documentation Updates

None beyond architecture-update.md.
