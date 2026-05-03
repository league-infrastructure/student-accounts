---
id: '006'
title: "Server: WorkspaceSyncService.syncStudents \u2014 drop cohort OU loop; all\
  \ upserts to /Students"
status: done
use-cases:
- SUC-007
depends-on:
- '001'
github-issue: ''
todo: ''
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: WorkspaceSyncService.syncStudents — drop cohort OU loop; all upserts to /Students

## Description

Simplify `WorkspaceSyncService.syncStudents` by removing the per-cohort OU iteration
loop. Cohorts are no longer the mechanism for assigning Google OU paths. All new student
user rows are created with `cohort_id=null`.

This completes the cohort deprecation on the provisioning side that Sprint 025 ticket 004
started (which redirected OU syncs from Cohort rows to Group rows).

**What is removed**: The block starting at
`const cohorts = await this.cohortRepo.findAllWithOUPath(db)` and the subsequent
`for (const cohort of cohorts)` loop in `syncStudents`.

**What is preserved**: All Cohort table rows, User.cohort_id column values, and
the `CohortRepository` itself remain in the codebase — this ticket does not migrate
data or delete the Cohort model.

## Acceptance Criteria

- [x] `syncStudents` no longer calls `cohortRepo.findAllWithOUPath`.
- [x] All `_upsertUserFromWorkspace` calls within `syncStudents` use `cohortId=null`.
- [x] `syncStudents` still fetches root-level users from the `studentRoot` OU.
- [x] `syncStudents` still flags removed workspace ExternalAccounts and deactivates not-seen students.
- [x] Existing `CohortRepository` import may remain or be removed — if it becomes unused in `WorkspaceSyncService`, remove the import.
- [x] Existing Cohort rows and User.cohort_id assignments in the database are untouched.
- [x] All server tests pass after the change (`npm run test:server`).
- [x] Any existing `syncStudents` tests that mock cohort data are updated to reflect the simplified flow.

## Implementation Plan

### Approach

Edit `server/src/services/workspace-sync.service.ts`:

1. Remove the "Per-cohort students" block from `syncStudents` (step 2 in the existing
   comments), specifically:
   ```typescript
   // 2. Per-cohort students
   const cohorts = await this.cohortRepo.findAllWithOUPath(db);
   for (const cohort of cohorts) {
     const cohortUsers = await this.googleClient.listUsersInOU(cohort.google_ou_path!);
     for (const wsUser of cohortUsers) {
       if (wsUser.suspended) continue;
       await this._upsertUserFromWorkspace(db, wsUser, cohort.id, actorId);
       seenEmails.add(wsUser.primaryEmail);
       studentsUpserted++;
     }
   }
   ```
2. Remove the `cohortRepo` parameter from the constructor if it is no longer used
   anywhere in this service. Check all methods — if `cohortRepo` is still used by
   `syncCohorts` or another method, leave it. (Inspection: `syncCohorts` uses
   `GroupRepository`, not `CohortRepository`, after Sprint 025 ticket 004. Verify
   before removing.)
3. Update the JSDoc on `syncStudents` to remove the reference to per-cohort iteration.

### Files to modify

- `server/src/services/workspace-sync.service.ts` — remove cohort loop; update JSDoc

### Files that may also need updating

- Any test files for `syncStudents` that set up cohort fixtures or assert on
  `cohort_id` assignments (update to verify `cohort_id=null`).

### Testing plan

- Run `npm run test:server` — confirm all existing tests pass.
- If a test exists for `syncStudents` that mocks `cohortRepo.findAllWithOUPath`, simplify
  it: remove the cohort mock, assert that no cohort queries are made, and confirm that
  upserted users have `cohort_id=null`.
- New test (if no existing syncStudents test): verify that a mock `listUsersInOU(studentRoot)`
  call results in users upserted with `cohort_id=null` and that `cohortRepo` is never called.

### Documentation updates

None required.
