---
id: '004'
title: POST /api/admin/users/:id/provision-workspace endpoint
status: done
use-cases:
  - SUC-010-004
depends-on: []
github-issue: ''
todo: plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# POST /api/admin/users/:id/provision-workspace endpoint

## Description

Admins need to create a League Workspace account for a student directly from
the User Detail page, without going through a ProvisioningRequest. Add a new
route handler that calls `WorkspaceProvisioningService.provision` on demand.

This mirrors the existing `POST /admin/users/:id/provision-claude` handler
added in Sprint 005.

## Acceptance Criteria

- [x] `POST /admin/users/:id/provision-workspace` route handler added (in `server/src/routes/admin/provision-workspace.ts`, mounted via `index.ts`).
- [x] Returns 422 if the user is not `role=student`.
- [x] Returns 422 if the user has no cohort assigned.
- [x] Returns 422 if the user already has an active `type=workspace` ExternalAccount.
- [x] On success, returns 201 with the new ExternalAccount record.
- [x] Calls `WorkspaceProvisioningService.provision(user, actor)` — same service as used by `ProvisioningRequestService`.
- [x] AuditEvent recorded (handled internally by `WorkspaceProvisioningService`).
- [x] Route-level tests covering all 422 conditions and the 201 success path.
- [x] `npm run test:server` passes.

## Implementation Plan

### Files to Modify

**`server/src/routes/admin/users.ts`**

Add handler for `POST /:id/provision-workspace`:
1. Load user by `id` from `req.params`.
2. Validate: `role=student`, cohort assigned, no active workspace ExternalAccount. Return 422 with descriptive message on each failure.
3. Call `req.services.workspaceProvisioning.provision(user, req.user)`.
4. Return 201 with the new ExternalAccount.

Check existing `provision-claude` handler for the exact pattern to follow (import
of `workspaceProvisioning` from `req.services`, error handling, response shape).

### Testing Plan

**New tests in:** `tests/server/routes/admin/users.provision-workspace.test.ts`
(or extend existing `users.test.ts` if it's not too large)

Scenarios:
- Student with cohort + no workspace → 201, ExternalAccount created.
- Non-student user → 422.
- Student with no cohort → 422.
- Student with existing active workspace account → 422.

Use `FakeGoogleWorkspaceAdminClient` (already exists) to avoid real API calls.

Run `npm run test:server`.
