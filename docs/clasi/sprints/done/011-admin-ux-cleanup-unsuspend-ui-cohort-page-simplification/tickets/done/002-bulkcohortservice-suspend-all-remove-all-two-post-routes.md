---
id: '002'
title: BulkCohortService suspend-all / remove-all + two POST routes
status: done
use-cases:
- SUC-011-002
depends-on: []
github-issue: ''
todo: cohort-page-simplify-bulk-buttons.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# BulkCohortService suspend-all / remove-all + two POST routes

## Description

Add two new methods on `BulkCohortService`
(`suspendAllInCohort(cohortId, actorId)` and
`removeAllInCohort(cohortId, actorId)`) that operate across every
live `workspace` + `claude` `ExternalAccount` for every active student
in the cohort. Expose them via
`POST /admin/cohorts/:id/bulk-suspend-all` and
`POST /admin/cohorts/:id/bulk-remove-all`.

Both methods use the existing per-account transaction / fail-soft
pattern. Failure entries include the account's `type` so the UI can
report "name (claude): reason".

## Acceptance Criteria

- [x] `BulkCohortService.suspendAllInCohort(cohortId, actorId)` iterates every active `workspace` + `claude` `ExternalAccount` for active students in the cohort, calling `externalAccountLifecycle.suspend` on each in its own transaction, fail-soft.
- [x] `BulkCohortService.removeAllInCohort(cohortId, actorId)` iterates every `active` or `suspended` `workspace` + `claude` `ExternalAccount` for active students in the cohort, calling `externalAccountLifecycle.remove` on each in its own transaction, fail-soft.
- [x] Both methods throw `NotFoundError` when the cohort does not exist.
- [x] The returned `BulkOperationResult` failures include a `type` field set to `'workspace'` or `'claude'`.
- [x] `POST /admin/cohorts/:id/bulk-suspend-all` exists, accepts no body, returns 200 on all-succeed / zero-eligible, 207 on partial failure, 404 on missing cohort, 400 on invalid id.
- [x] `POST /admin/cohorts/:id/bulk-remove-all` exists with the same contract.
- [x] `npm run test:server` passes.

## Plan

### Files to modify
- `server/src/services/bulk-cohort.service.ts`
- `server/src/routes/admin/bulk-cohort.ts`

### Approach
1. Add `_loadAllEligibleForSuspend(cohortId)` and
   `_loadAllEligibleForRemove(cohortId)` that use
   `type: { in: ['workspace', 'claude'] }`.
2. Carry `type` through each row to the failure entry. The cleanest
   way is to add an optional `type` on the `_processAccounts` account
   shape -- existing callers ignore it.
3. Add the two new service methods.
4. Add the two new route handlers mirroring the existing per-type
   ones but with no body validation.

### Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - service: suspendAllInCohort iterates both types, fail-soft.
  - service: removeAllInCohort accepts both active and suspended accounts.
  - service: NotFoundError when cohort does not exist.
  - service: failures include `type`.
  - route: 200 when all succeed, 207 when partial failure, 404 when cohort missing.
- **Verification command**: `npm run test:server`
