---
id: "005"
title: "Admin merge-queue API routes — list, detail, approve, reject, defer"
status: todo
use-cases: [SUC-007-002, SUC-007-003]
depends-on: ["004"]
github-issue: ""
todo: ""
---

# Admin merge-queue API routes — list, detail, approve, reject, defer

## Description

Create `server/src/routes/admin/merge-queue.ts` and mount it in
`server/src/routes/admin/index.ts`. All routes require `requireAuth` and
`requireRole('admin')`.

Routes to implement:

| Method | Path | Description |
|---|---|---|
| GET | `/admin/merge-queue` | List pending + deferred suggestions with User summaries |
| GET | `/admin/merge-queue/:id` | Single suggestion detail with full User + Login + ExternalAccount data |
| POST | `/admin/merge-queue/:id/approve` | Body: `{ survivorId: number }`. Calls `MergeSuggestionService.approve()` |
| POST | `/admin/merge-queue/:id/reject` | Calls `MergeSuggestionService.reject()` |
| POST | `/admin/merge-queue/:id/defer` | Calls `MergeSuggestionService.defer()` |

Follow the pattern of `server/src/routes/admin/sync.ts` for route structure.
Use `ServiceRegistry.create('UI')` to get the service instance.

## Acceptance Criteria

- [ ] `GET /admin/merge-queue` returns HTTP 200 with an array of queue items
      (pending + deferred) including User A and User B name and email fields.
- [ ] `GET /admin/merge-queue/:id` returns HTTP 200 with full user detail
      (Logins, ExternalAccounts arrays for each user).
- [ ] `GET /admin/merge-queue/:id` returns HTTP 404 when suggestion ID does not exist.
- [ ] `POST /admin/merge-queue/:id/approve` with valid `{ survivorId }` returns HTTP 200.
- [ ] `POST /admin/merge-queue/:id/approve` without `survivorId` returns HTTP 400.
- [ ] `POST /admin/merge-queue/:id/approve` when survivor ID is not one of the two
      users in the suggestion returns HTTP 400.
- [ ] `POST /admin/merge-queue/:id/approve` on an already-decided suggestion returns
      HTTP 409.
- [ ] `POST /admin/merge-queue/:id/reject` returns HTTP 200.
- [ ] `POST /admin/merge-queue/:id/defer` returns HTTP 200.
- [ ] All routes return HTTP 401 for unauthenticated requests.
- [ ] All routes return HTTP 403 for non-admin authenticated requests.
- [ ] New router is mounted in `routes/admin/index.ts`.

## Implementation Plan

### Approach

1. Create `server/src/routes/admin/merge-queue.ts`.
2. Import `ServiceRegistry` and middleware (`requireAuth`, `requireRole`).
3. Implement each route as a thin handler that validates input and delegates to
   `services.mergeSuggestions`.
4. For the `approve` route, validate that `survivorId` is a number and matches
   either `user_a_id` or `user_b_id` of the suggestion (load the suggestion first
   or validate after `MergeSuggestionService` throws).
5. Map `MergeConflictError` to HTTP 409.
6. Mount in `routes/admin/index.ts`: `adminRouter.use('/admin', adminMergeQueueRouter)`.

### Files to Create/Modify

- `server/src/routes/admin/merge-queue.ts` — new
- `server/src/routes/admin/index.ts` — add import and mount

### Testing Plan

Supertest integration tests in `tests/server/admin/merge-queue.test.ts`:
- Authenticated admin session fixture.
- GET list: assert response shape.
- GET detail: assert Logins and ExternalAccounts are present.
- POST approve: assert 200 and side-effects (via a follow-up DB query).
- POST approve with bad survivorId: assert 400.
- POST reject: assert 200.
- POST defer: assert 200.
- GET/POST without auth: assert 401.

### Documentation Updates

None required — routes are self-documenting via the API response.
