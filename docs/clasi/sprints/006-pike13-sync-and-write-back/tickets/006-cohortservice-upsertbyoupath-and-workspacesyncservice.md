---
id: "006"
title: "CohortService.upsertByOUPath and WorkspaceSyncService"
status: todo
use-cases: [SUC-001, SUC-002, SUC-003, SUC-004]
depends-on: ["002", "005"]
github-issue: ""
todo: ""
---

# CohortService.upsertByOUPath and WorkspaceSyncService

## Description

Two related pieces of work that are best implemented together:

1. Add `CohortService.upsertByOUPath(ouPath, name)` — creates or updates a
   Cohort row keyed on `google_ou_path`. Does NOT call
   `GoogleWorkspaceAdminClient.createOU` — the OU already exists.

2. Implement `WorkspaceSyncService` with four methods: `syncCohorts`,
   `syncStaff`, `syncStudents`, `syncAll`. This service is the core of the
   Google Workspace sync epic (SUC-001 through SUC-004).

## Acceptance Criteria

### CohortService.upsertByOUPath

- [ ] `CohortService.upsertByOUPath(ouPath: string, name: string): Promise<Cohort>`
  added to `server/src/services/cohort.service.ts`.
- [ ] Uses Prisma `upsert` keyed on `google_ou_path`; creates if not found,
  updates `name` if changed.
- [ ] Does not call `createOU` or any Google Admin SDK method.
- [ ] Returns the upserted Cohort row.
- [ ] Unit test: upsert creates new row; upsert updates name on existing row.

### WorkspaceSyncService

- [ ] `server/src/services/workspace-sync.service.ts` exists.
- [ ] `syncCohorts()`:
  - Calls `GoogleWorkspaceAdminClient.listOUs(studentRoot)`.
  - For each child OU: calls `CohortService.upsertByOUPath`.
  - Returns `WorkspaceSyncReport` with cohort counts.
  - AuditEvent: action=sync_cohorts_completed.
- [ ] `syncStaff()`:
  - Skips (returns informational message) if `GOOGLE_STAFF_OU_PATH` is unset.
  - Calls `listUsersInOU(staffOuPath)`.
  - For each user: upserts User with role=staff; never downgrades admin.
  - created_via=workspace_sync for new rows.
  - Returns `WorkspaceSyncReport` with staff counts.
  - AuditEvent: action=sync_staff_completed.
- [ ] `syncStudents()`:
  - Calls `listUsersInOU(studentRoot)` for root-level students.
  - For each Cohort with non-null `google_ou_path`: calls `listUsersInOU`.
  - Upserts Users; role=student; cohort_id from OU; skips admins/staff.
  - Flags ExternalAccount(type=workspace) rows for emails not seen: sets
    status=removed, records action=workspace_sync_flagged AuditEvent.
  - Returns `WorkspaceSyncReport` with student counts + `flaggedAccounts[]`.
  - AuditEvent: action=sync_students_completed.
- [ ] `syncAll()`:
  - Runs syncCohorts → syncStaff → syncStudents in sequence.
  - Each sub-operation failure is recorded; remaining operations still run.
  - Returns combined `WorkspaceSyncReport`.
  - AuditEvent: action=sync_all_completed.
- [ ] `WorkspaceSyncService` is registered in `ServiceRegistry`.
- [ ] Integration tests cover all four methods using `FakeGoogleWorkspaceAdminClient`
  and a test database.

## Implementation Plan

### Approach

1. Add `upsertByOUPath` to `CohortService`. Write unit test.
2. Create `WorkspaceSyncService`. Inject: `GoogleWorkspaceAdminClient`,
   `CohortService`, `UserRepository` (or `UserService`),
   `ExternalAccountRepository`, `AuditService`, and `CohortRepository`
   (to list cohorts with `google_ou_path` during student sync).
3. Implement `syncCohorts` first (simplest); run against fake client to verify.
4. Implement `syncStaff`; handle the missing-env-var guard.
5. Implement `syncStudents`; include the flag-only removal logic.
6. Implement `syncAll` as a thin coordinator.
7. Register in `ServiceRegistry`.
8. Write integration tests per method.

### Files to Create

- `server/src/services/workspace-sync.service.ts`
- `tests/server/services/workspace-sync.service.test.ts`

### Files to Modify

- `server/src/services/cohort.service.ts` — add `upsertByOUPath`
- `server/src/services/service.registry.ts` — register `WorkspaceSyncService`

### Testing Plan

- Integration tests using `FakeGoogleWorkspaceAdminClient` with seeded OUs
  and users. Scenarios per method:
  - syncCohorts: new OUs create Cohorts; existing OUs update name; empty result.
  - syncStaff: new staff users created; existing updated to staff; admin preserved;
    GOOGLE_STAFF_OU_PATH absent = skip.
  - syncStudents: cohort assignment by OU path; root users get null cohort;
    admin/staff skipped; flags removed workspace accounts.
  - syncAll: fail-soft when one sub-operation errors.

### Documentation Updates

- None. Architecture update covers all interface contracts and semantics.
