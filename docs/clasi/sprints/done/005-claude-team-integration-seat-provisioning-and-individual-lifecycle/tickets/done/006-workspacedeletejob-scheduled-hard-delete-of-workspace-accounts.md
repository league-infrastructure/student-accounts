---
id: "006"
title: "WorkspaceDeleteJob — scheduled hard-delete of Workspace accounts"
status: done
use-cases: [SUC-007]
depends-on: ["001", "002"]
---

# WorkspaceDeleteJob — scheduled hard-delete of Workspace accounts

## Description

Implement `WorkspaceDeleteJob` — a background job registered on the template's
existing `SchedulerService` infrastructure. The job:

1. Queries `ExternalAccount` records with `type='workspace'`, `status='removed'`,
   and `scheduled_delete_at <= now()` and `scheduled_delete_at IS NOT NULL`.
2. For each, calls `GoogleWorkspaceAdminClient.deleteUser(email)`.
3. On success: sets `scheduled_delete_at = null` on the ExternalAccount row (to
   prevent re-processing) and records an AuditEvent with action=workspace_hard_delete.
4. On failure: logs at ERROR level and continues to the next record (fail-soft).

The job runs on startup and then every hour (or configurable via
`WORKSPACE_DELETE_JOB_INTERVAL_MINUTES`). It processes only records that are
past their scheduled delete date.

## Acceptance Criteria

- [x] `server/src/jobs/workspace-delete.job.ts` created.
- [x] Job is registered with `SchedulerService` on server startup.
- [x] Job queries ExternalAccount: type=workspace, status=removed, scheduled_delete_at <= now.
- [x] `GoogleWorkspaceAdminClient.deleteUser` called for each eligible record.
- [x] After successful delete: `scheduled_delete_at` set to null on the ExternalAccount row.
- [x] AuditEvent recorded with action=workspace_hard_delete (actor_user_id=null = system action).
- [x] Failed deletes logged at ERROR level; job continues to next record.
- [x] Integration tests pass.

## Implementation Plan

### Approach

1. Check how the existing `SchedulerService` registers jobs (look at
   `server/src/services/scheduler.service.ts`). Follow the same pattern.
2. Create `server/src/jobs/workspace-delete.job.ts` with a `run()` function
   that implements the batch processing logic.
3. Register the job in `server/src/app.ts` or `server/src/index.ts` after
   services are initialized.

The job should use `prisma.$transaction` per record (not one giant transaction)
so a failure on one record does not roll back successful deletes.

### Files to create/modify

- `server/src/jobs/workspace-delete.job.ts` (new)
- `server/src/index.ts` or `server/src/app.ts` — register the job at startup.
- `server/src/services/repositories/external-account.repository.ts` — add
  `findPendingDeletion()` method if not present.

### Testing plan

Integration tests in `tests/server/jobs/workspace-delete.job.test.ts`:
- Record past deadline: deleteUser called, scheduled_delete_at cleared, audit event recorded.
- Record future deadline: deleteUser NOT called.
- Record scheduled_delete_at=null: NOT processed.
- API failure: error logged, job continues, other records processed.

Use `FakeGoogleWorkspaceAdminClient` from Sprint 004 tests.

### Documentation updates

None.
