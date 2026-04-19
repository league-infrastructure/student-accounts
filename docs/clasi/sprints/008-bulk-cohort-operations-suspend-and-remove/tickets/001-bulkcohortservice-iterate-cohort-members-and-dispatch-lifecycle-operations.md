---
id: "001"
title: "BulkCohortService — iterate cohort members and dispatch lifecycle operations"
status: todo
use-cases: [SUC-008-002, SUC-008-003, SUC-008-004]
depends-on: []
---

# BulkCohortService — iterate cohort members and dispatch lifecycle operations

## Description

Create `server/src/services/bulk-cohort.service.ts`. This is the core service
for Sprint 008: it loads all eligible ExternalAccounts in a cohort and applies
a suspend or remove lifecycle operation to each, using the per-account
transaction pattern established in `deprovision.ts`. This service has no
external API knowledge; it delegates entirely to `ExternalAccountLifecycleService`.

## Acceptance Criteria

- [ ] `server/src/services/bulk-cohort.service.ts` exists and exports `BulkCohortService`.
- [ ] Constructor accepts `(prisma, externalAccountLifecycle, userRepository, externalAccountRepository)`.
- [ ] `suspendCohort(cohortId, accountType, actorId)` loads all active users in
      the cohort (is_active=true, cohort_id=cohortId), finds active ExternalAccounts
      of `accountType` per user, and calls `externalAccountLifecycle.suspend(id, actorId, tx)`
      inside an individual `prisma.$transaction` per account.
- [ ] `removeCohort(cohortId, accountType, actorId)` targets accounts with
      status in ['active', 'suspended'] and calls `.remove(id, actorId, tx)`.
- [ ] `previewCount(cohortId, accountType, operation)` returns the count of
      eligible accounts without mutating any record.
- [ ] Per-account failures are caught; the loop continues; failures are
      collected in the result. A single account failure does not abort the batch.
- [ ] Return type is `BulkOperationResult`:
      `{ succeeded: number[]; failed: { accountId: number; userId: number; userName: string; error: string }[] }`.
- [ ] Throws `NotFoundError` if `cohortId` does not exist.
- [ ] `ServiceRegistry` gains `readonly bulkCohort: BulkCohortService` instantiated
      after `externalAccountLifecycle`.
- [ ] Unit tests cover: all succeed, all fail, partial failure (middle account
      throws), zero eligible accounts, cohort not found.

## Implementation Plan

### Approach

Follow the pattern in `server/src/routes/admin/deprovision.ts`: iterate
eligible accounts, wrap each in `prisma.$transaction`, collect succeeded/failed.
Load accounts with `include: { user: { select: { id: true, display_name: true } } }`
to get user names in a single query for the failure report.

### Files to create

- `server/src/services/bulk-cohort.service.ts`
- `tests/server/bulk-cohort.service.test.ts`

### Files to modify

- `server/src/services/service.registry.ts` — add `bulkCohort` property and
  instantiate it after `this.externalAccountLifecycle` is set.

### Eligible account filter

For `suspend`: `status: 'active', type: accountType`

For `remove`: `status: { in: ['active', 'suspended'] }, type: accountType`

Both: filter users with `cohort_id: cohortId, is_active: true`.

### Testing plan

Inject a fake `ExternalAccountLifecycleService` that records calls or throws
on demand. Seed a test cohort with users and external accounts using the
in-process SQLite test DB.

Key test cases:
- All 3 accounts succeed: `succeeded.length === 3`, `failed === []`
- All fail: `succeeded === []`, `failed.length === 3` with error messages
- Partial: second of three throws: `succeeded = [id1, id3]`, `failed = [{ accountId: id2 }]`
- Zero eligible: empty result, no lifecycle calls made
- Cohort not found: throws NotFoundError

### Documentation updates

None. Internal service; no user-facing docs.

