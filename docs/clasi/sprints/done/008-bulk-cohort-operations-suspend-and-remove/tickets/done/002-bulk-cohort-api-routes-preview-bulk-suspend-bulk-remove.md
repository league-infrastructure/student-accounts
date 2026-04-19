---
id: "002"
title: "Bulk cohort API routes — preview, bulk-suspend, bulk-remove"
status: done
use-cases: [SUC-008-002, SUC-008-003, SUC-008-006]
depends-on: ["001"]
---

# Bulk cohort API routes — preview, bulk-suspend, bulk-remove

## Description

Create `server/src/routes/admin/bulk-cohort.ts` with three route handlers that
expose `BulkCohortService` to the admin UI. Mount the router in `index.ts`.
Routes are thin adapters: validate input, call the service, format the response.

## Acceptance Criteria

- [x] `GET /api/admin/cohorts/:id/bulk-preview?accountType=workspace|claude&operation=suspend|remove`
      returns `{ eligibleCount: number }` (200).
- [x] `POST /api/admin/cohorts/:id/bulk-suspend` with body `{ accountType: 'workspace' | 'claude' }`
      calls `BulkCohortService.suspendCohort` and returns the result.
- [x] `POST /api/admin/cohorts/:id/bulk-remove` with body `{ accountType: 'workspace' | 'claude' }`
      calls `BulkCohortService.removeCohort` and returns the result.
- [x] Returns 200 when all accounts succeeded (including zero eligible).
- [x] Returns 207 when at least one account failed and at least one succeeded.
- [x] Returns 400 for missing or invalid `accountType` or `operation`.
- [x] Returns 404 when the cohort does not exist (service throws NotFoundError).
- [x] Returns 500 for unexpected errors (falls through to global errorHandler).
- [x] All three routes are reachable only by `requireAuth` + `requireRole('admin')`
      (enforced by `adminRouter` upstream — no additional guards in the handler).
- [x] `server/src/routes/admin/index.ts` imports and mounts `adminBulkCohortRouter`.
- [x] Integration tests cover: happy path (all succeed), partial failure (207),
      invalid accountType (400), unknown cohort (404).

## Implementation Plan

### Approach

Follow the pattern of `server/src/routes/admin/deprovision.ts` for error
handling and fail-soft response shape. Access `BulkCohortService` via
`req.services.bulkCohort` (after T001 adds it to ServiceRegistry).

### Files to create

- `server/src/routes/admin/bulk-cohort.ts`
- `tests/server/bulk-cohort.routes.test.ts`

### Files to modify

- `server/src/routes/admin/index.ts` — add import and mount.

### Route response shape

All bulk mutation routes return:
```json
{
  "succeeded": [1, 2, 3],
  "failed": [
    { "accountId": 4, "userId": 7, "userName": "Alice", "error": "..." }
  ]
}
```

HTTP 207 condition: `failed.length > 0 && succeeded.length > 0`.
HTTP 200: all succeeded (failed is empty), or zero eligible.

### Testing plan

Use Supertest with a seeded in-process SQLite DB and a fake
`ExternalAccountLifecycleService` injected via the ServiceRegistry's
optional-client constructor parameters.

Key test cases:
- `GET /bulk-preview` returns correct count
- `POST /bulk-suspend` with all accounts succeeding → 200
- `POST /bulk-suspend` with one account failing → 207 with failure detail
- `POST /bulk-remove` missing accountType → 400
- `POST /bulk-remove` for nonexistent cohort → 404

### Documentation updates

None. Internal admin API.

