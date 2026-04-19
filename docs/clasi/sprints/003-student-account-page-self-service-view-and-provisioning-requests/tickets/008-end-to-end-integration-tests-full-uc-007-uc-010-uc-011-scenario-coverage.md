---
id: "008"
title: "End-to-end integration tests — full UC-007, UC-010, UC-011 scenario coverage"
status: todo
use-cases: [SUC-001, SUC-002, SUC-003, SUC-004, SUC-005]
depends-on: ["001", "002", "003", "004", "005", "006", "007"]
github-issue: ""
todo: ""
---

# End-to-end integration tests — full UC-007, UC-010, UC-011 scenario coverage

## Description

Write server-side integration tests that cover the complete user flows for the
three use cases delivered by Sprint 003 (UC-007, UC-010, UC-011). These tests
exercise the full stack below the HTTP layer: route → service → repository →
SQLite, using the real test DB and Supertest.

This ticket does not add new application code. It adds a dedicated scenario
test file that walks through complete use case flows, verifying that all the
pieces built in T001–T007 compose correctly.

Individual unit and route-level tests are already written in T001–T005.
This ticket adds the narrative-level tests that verify the correct sequence
of operations across multiple endpoints.

## Acceptance Criteria

- [ ] All scenarios listed below pass against the real SQLite test DB.
- [ ] No test file imports or mocks service internals — tests drive via HTTP
      (Supertest) and verify via DB queries or subsequent GET /api/account.
- [ ] Tests are independent (each creates its own user and test data;
      global-setup truncates between runs).
- [ ] The complete test suite (`npm test` or `npx vitest`) passes with no
      failures, including all Sprint 001 and Sprint 002 tests.

## Scenarios

### UC-011 (Student removes own Login) — full flow

1. Create user with two logins (via factory).
2. Authenticate session as user.
3. `DELETE /api/account/logins/:id` on the first login → 204.
4. `GET /api/account` → login no longer in response.
5. `DELETE /api/account/logins/:id` on the remaining login → 409 (blocked).

### UC-007 Option A (Request League Email) — full flow

1. Create student user with no external accounts or provisioning requests.
2. Authenticate session.
3. `GET /api/account` → Services section shows no workspace account/request.
4. `POST /api/account/provisioning-requests` with `{ requestType: "workspace" }` → 201.
5. `GET /api/account` → provisioningRequests contains one workspace/pending entry.
6. `POST /api/account/provisioning-requests` with `{ requestType: "workspace" }`
   again → 409 (duplicate).

### UC-007 Option B (Request Email + Claude) — constraint enforcement

1. Create student user with no accounts or requests.
2. Authenticate session.
3. `POST /api/account/provisioning-requests` with `{ requestType: "workspace_and_claude" }`
   → 422 (no workspace baseline).
4. `POST /api/account/provisioning-requests` with `{ requestType: "workspace" }` → 201.
5. `POST /api/account/provisioning-requests` with `{ requestType: "workspace_and_claude" }`
   → 422 (workspace is now pending, but we already requested it; this request
   type would create a duplicate workspace — return 409 or re-check behavior).

   Note to implementer: verify whether step 5 should be 409 (duplicate workspace
   request) or succeed by creating only the claude row. The current architecture
   specifies creating both rows; since workspace already exists as pending, the
   conflict check fires. A separate test for requesting just Claude after the
   workspace is already provisioned should be added if that path is supported.

6. Create user with an active workspace ExternalAccount (via factory, bypassing
   service layer).
7. Authenticate session as that user.
8. `POST /api/account/provisioning-requests` with `{ requestType: "workspace_and_claude" }`
   → 422 (workspace already active, not pending). Test the behavior with
   active ExternalAccount vs. pending request.

   Clarification: if the constraint check allows Claude when workspace ExternalAccount
   is active (even for workspace_and_claude), adjust test expectation accordingly.

### Cross-user scope guard

1. Create two student users, each with one login.
2. Authenticate as user A.
3. `DELETE /api/account/logins/:id` using a login_id belonging to user B → 404.
4. Login count for user B unchanged (verify via DB).

### Role guards (regression)

1. Create staff user, authenticate.
2. `GET /api/account` → 403.
3. `POST /api/account/provisioning-requests` → 403.
4. `DELETE /api/account/logins/:id` → 403.

## Implementation Plan

### Files to Create

- `tests/server/scenarios/sprint-003-scenarios.test.ts` — new scenario test file

### Testing Plan

This ticket IS the testing. All tests use Supertest against the Express app
with a real SQLite test DB. Session authentication is simulated using the same
approach as Sprint 002 tests (fake Passport strategy or direct session cookie
injection via test helpers).

Verify all Sprint 001 and Sprint 002 tests still pass as regression check.
