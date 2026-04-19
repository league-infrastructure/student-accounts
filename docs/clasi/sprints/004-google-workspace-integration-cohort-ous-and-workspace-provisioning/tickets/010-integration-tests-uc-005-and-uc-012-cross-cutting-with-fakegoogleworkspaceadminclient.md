---
id: "010"
title: "Integration tests — UC-005 and UC-012 cross-cutting with FakeGoogleWorkspaceAdminClient"
status: todo
use-cases: [UC-005, UC-012]
depends-on: ["004", "005", "007", "008", "009"]
github-issue: ""
todo: ""
---

# Integration tests — UC-005 and UC-012 cross-cutting with FakeGoogleWorkspaceAdminClient

## Description

This ticket consolidates cross-cutting integration tests for the two use cases
delivered in Sprint 004. These tests exercise the full path through real service
layers and a real SQLite database, using `FakeGoogleWorkspaceAdminClient` to
avoid network calls.

Individual ticket tests (T001-T009) cover unit-level scenarios for specific
modules. This ticket covers end-to-end scenarios that span multiple modules and
verify the use cases as a whole.

## Acceptance Criteria

### UC-012: Admin Creates Cohort — end-to-end

- [ ] Test: `POST /admin/cohorts` with a valid cohort name and admin session →
      201 response, Cohort row exists in DB with correct `name` and
      `google_ou_path`, `FakeGoogleWorkspaceAdminClient.calls.createOU` was
      called with the expected name, AuditEvent row exists with
      action=`create_cohort`.
- [ ] Test: `POST /admin/cohorts` when `FakeGoogleWorkspaceAdminClient.createOU`
      is configured to throw → 502 response, NO Cohort row created in DB, NO
      AuditEvent written.
- [ ] Test: `POST /admin/cohorts` with a duplicate name → 409 response,
      `createOU` was NOT called (validation fires before API call).
- [ ] Test: `POST /admin/cohorts` with an unauthenticated request → 401.
- [ ] Test: `POST /admin/cohorts` with a student session → 403.

### UC-005: Admin Provisions Workspace via Approval — end-to-end

- [ ] Test: A pending workspace ProvisioningRequest exists for a student with a
      cohort assigned. `POST /admin/provisioning-requests/:id/approve` with admin
      session → 200 response, ProvisioningRequest status=approved, ExternalAccount
      row exists (type=workspace, status=active, external_id from fake),
      `FakeGoogleWorkspaceAdminClient.calls.createUser[0].primaryEmail` ends with
      `@students.jointheleague.org`, `FakeGoogleWorkspaceAdminClient.calls.createUser[0].orgUnitPath`
      equals cohort's `google_ou_path`, AuditEvents: `approve_provisioning_request`
      and `provision_workspace`.
- [ ] Test: Approve when student has no cohort → 422 response, request remains
      pending, no ExternalAccount created, no API call made.
- [ ] Test: Approve when student role is not `student` → 422, no ExternalAccount.
- [ ] Test: Approve when student already has an active workspace ExternalAccount →
      409 (ConflictError from provisioning service), request remains pending.
- [ ] Test: Approve when `FakeGoogleWorkspaceAdminClient.createUser` throws
      `WorkspaceApiError` → 502, request remains pending, no ExternalAccount
      created, no audit events written (transaction rolled back atomically).
- [ ] Test: `POST /admin/provisioning-requests/:id/reject` with admin session →
      200, request status=rejected, no ExternalAccount, no API call made,
      AuditEvent action=`reject_provisioning_request`.
- [ ] Test: `POST /admin/provisioning-requests/:id/approve` with student session →
      403.

### UC-005: Admin Provisions Workspace Direct (without provisioning request)

- [ ] This flow (direct admin provisioning from user detail view) is not yet
      fully wired in this sprint (the user detail view is Sprint 009). However,
      the `WorkspaceProvisioningService.provision` method can be tested directly
      via a test-only setup (bypassing the route) to confirm the service works
      without a ProvisioningRequest. One such test is sufficient.

### Guard and Safety

- [ ] Test: domain guard — attempting to call `createUser` with a
      `@jointheleague.org` email via the real `GoogleWorkspaceAdminClient`
      (not the fake, using the unit test from T002) → `WorkspaceDomainGuardError`.
      (This test may be in T002's test file; reference it here for completeness.)
- [ ] Test: write-enable flag — calling any write method on the real client
      without `GOOGLE_WORKSPACE_WRITE_ENABLED=1` → `WorkspaceWriteDisabledError`.
      (Same note — may be in T002's test file.)

### Suite Health

- [ ] All Sprint 001, 002, 003 tests continue to pass (no regressions).
- [ ] `npm test` shows no failures.
- [ ] Test run completes in under 30 seconds.

## Implementation Plan

### Approach

Test files use `Supertest` against the Express app (same pattern as existing
sprint tests). Each test uses the test-database factory helpers to create a
user with a cohort, a provisioning request, etc. The `FakeGoogleWorkspaceAdminClient`
is injected into the `ServiceRegistry` before each test (or via a test-level
setup helper). A fresh `FakeGoogleWorkspaceAdminClient` instance is created
per test to avoid cross-test call recording pollution.

### Files to Create

- `tests/server/sprints/sprint-004-uc-005.test.ts`
- `tests/server/sprints/sprint-004-uc-012.test.ts`

### Files to Modify

- `tests/server/global-setup.ts` — ensure new entity tables (no new tables in
  this sprint, but confirm AuditEvent, ExternalAccount, etc. are truncated).
- `tests/server/helpers/factories.ts` — add `makeCohortWithOU(overrides?)` factory
  that creates a Cohort with a non-null `google_ou_path` (e.g., `/Students/TestCohort`).

### Testing Plan

These are the tests themselves. No separate description needed.

### Documentation Updates

None. Tests are documentation.
