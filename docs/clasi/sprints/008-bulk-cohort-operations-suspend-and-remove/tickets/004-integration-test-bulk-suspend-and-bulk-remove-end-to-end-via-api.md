---
id: "004"
title: "Integration test — bulk suspend and bulk remove end-to-end via API"
status: todo
use-cases: [SUC-008-002, SUC-008-003, SUC-008-004, SUC-008-005, SUC-008-006]
depends-on: ["001", "002"]
---

# Integration test — bulk suspend and bulk remove end-to-end via API

## Description

Write Supertest integration tests that exercise the full stack from HTTP
request through `BulkCohortService` to the SQLite test database, using fake
Google and Claude clients (following the established test pattern in the
project). These tests verify the complete contract: DB state changes, audit
events, and response shape. They complement the unit tests written in T001
and T002.

## Acceptance Criteria

- [ ] Bulk suspend of a workspace account in a cohort: `ExternalAccount.status`
      changes to `'suspended'` in the DB, AuditEvent with `action='suspend_workspace'`
      is recorded, HTTP response lists the accountId in `succeeded`.
- [ ] Bulk suspend of a claude account: `ExternalAccount.status` = `'suspended'`,
      AuditEvent `action='suspend_claude'` recorded.
- [ ] Bulk remove of a workspace account: `ExternalAccount.status` = `'removed'`,
      `scheduled_delete_at` is set approximately 3 days from now,
      AuditEvent `action='remove_workspace'` recorded.
- [ ] Bulk remove of a claude account: `ExternalAccount.status` = `'removed'`,
      AuditEvent `action='remove_claude'` recorded.
- [ ] Partial failure: one fake client throws on the second of three accounts;
      response is HTTP 207; DB shows two accounts suspended/removed and one
      unchanged; AuditEvents for the two successful accounts are present.
- [ ] Preview endpoint returns the correct eligible count for both suspend and
      remove operations before any mutation.
- [ ] Accounts already in `'removed'` status are not counted by preview and are
      not processed by suspend or remove.
- [ ] Non-admin request returns 401 or 403 (verified by omitting session / using
      a non-admin session).
- [ ] All existing passing tests in `tests/server/` continue to pass.

## Implementation Plan

### Approach

Use the pattern established in existing route tests in `tests/server/`. Seed
the test DB with:
- One Cohort
- Three Users assigned to that cohort with is_active=true
- One workspace ExternalAccount per user (status=active) and one claude
  ExternalAccount per user (status=active)

Inject fake Google and Claude clients via the ServiceRegistry optional-client
constructor parameters. The fake clients record method calls so tests can
assert correct API interactions.

To test partial failure: configure the fake Google client to throw on a
specific email address.

### Files to create

- `tests/server/bulk-cohort-integration.test.ts`

### Testing plan

Each test case:
1. Seed the DB (within a beforeEach that clears data).
2. Establish an admin session.
3. Make the HTTP request via Supertest.
4. Assert HTTP status and response body.
5. Query the DB directly to assert ExternalAccount status and AuditEvent records.

### Documentation updates

None. Test infrastructure only.

