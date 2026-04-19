---
id: "007"
title: "Admin sync routes: Pike13 and Workspace endpoints"
status: todo
use-cases: [UC-004, SUC-001, SUC-002, SUC-003, SUC-004]
depends-on: ["003", "006"]
github-issue: ""
todo: ""
---

# Admin sync routes: Pike13 and Workspace endpoints

## Description

Complete the `server/src/routes/admin/sync.ts` route file with all five sync
endpoints. Ticket 003 created the file with the Pike13 endpoint; this ticket
adds the four Workspace endpoints and wires the full router into `app.ts`.

If the route file was not created in ticket 003 (because it was deferred), this
ticket creates it from scratch with all five routes.

## Acceptance Criteria

- [ ] `server/src/routes/admin/sync.ts` contains all five endpoints:
  - `POST /admin/sync/pike13` → `Pike13SyncService.sync()`
  - `POST /admin/sync/workspace/cohorts` → `WorkspaceSyncService.syncCohorts()`
  - `POST /admin/sync/workspace/staff` → `WorkspaceSyncService.syncStaff()`
  - `POST /admin/sync/workspace/students` → `WorkspaceSyncService.syncStudents()`
  - `POST /admin/sync/workspace/all` → `WorkspaceSyncService.syncAll()`
- [ ] All routes are protected by `requireAuth` + `requireRole('admin')`.
- [ ] All routes return HTTP 200 with the service's report object as JSON.
- [ ] Service errors (exception thrown) are caught and returned as HTTP 500 with
  `{ error: string }` (standard error handler pattern).
- [ ] Router is mounted at `/admin/sync` in `server/src/app.ts`.
- [ ] Route integration tests: 403 for non-admin, 200 + report for admin,
  500 response when service throws.

## Implementation Plan

### Approach

1. Open (or create) `server/src/routes/admin/sync.ts`.
2. Add Workspace endpoints alongside the Pike13 endpoint.
3. Use `ServiceRegistry.create('UI')` to access services (same pattern as
   other admin routes).
4. Mount in `app.ts`.
5. Write route integration tests.

### Files to Modify

- `server/src/routes/admin/sync.ts` — add Workspace endpoints
- `server/src/app.ts` — mount `/admin/sync` router (if not done in ticket 003)

### Files to Create

- `tests/server/routes/admin/sync.test.ts` (route integration tests)

### Testing Plan

- Route integration tests using supertest.
- 403 returned for non-admin on each endpoint.
- 200 + correct report shape returned for admin (services mocked to return
  known report values).
- 500 returned when service throws (confirm error handler shape).

### Documentation Updates

- None. Architecture update already documents all route paths and response
  shapes.
