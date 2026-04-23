---
id: '004'
title: Admin groups HTTP routes
status: done
use-cases:
- SUC-012-001
- SUC-012-002
- SUC-012-003
- SUC-012-004
- SUC-012-005
- SUC-012-006
- SUC-012-007
- SUC-012-008
depends-on:
- '002'
- '003'
github-issue: ''
todo: ''
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Admin groups HTTP routes

## Description

Expose every `GroupService` and `BulkGroupService` capability via
admin HTTP routes, mirroring the conventions in `admin/cohorts.ts`
and `admin/bulk-cohort.ts`.

## Acceptance Criteria

- [x] `server/src/routes/admin/groups.ts` exports `adminGroupsRouter`.
- [x] Router is mounted in `server/src/routes/admin/index.ts` via
      `adminRouter.use('/admin', adminGroupsRouter)` with
      `requireAuth` + `requireRole('admin')` inherited.
- [x] Routes implemented (all under `/admin`):

  | Method | Path | Body / Query | Success |
  |---|---|---|---|
  | GET | `/groups` | — | 200 `{id,name,description,memberCount,createdAt}[]` |
  | POST | `/groups` | `{name, description?}` | 201 group row |
  | GET | `/groups/:id` | — | 200 group |
  | PUT | `/groups/:id` | `{name?, description?}` | 200 updated group |
  | DELETE | `/groups/:id` | — | 204 |
  | GET | `/groups/:id/members` | — | 200 `{group, users}` |
  | POST | `/groups/:id/members` | `{userId}` | 201 `{userId}` |
  | DELETE | `/groups/:id/members/:userId` | — | 204 |
  | GET | `/groups/:id/user-search` | `q`, `limit?` | 200 `UserMatch[]` |
  | GET | `/users/:id/groups` | — | 200 `{id,name}[]` |
  | POST | `/groups/:id/bulk-provision` | `{accountType}` | 200/207 BulkResult |
  | POST | `/groups/:id/bulk-suspend-all` | — | 200/207 BulkResult |
  | POST | `/groups/:id/bulk-remove-all` | — | 200/207 BulkResult |

- [x] Error responses: 404 for missing group/user, 409 for duplicate
      name / duplicate membership, 422 for blank name, 400 for bad
      body / invalid `accountType`.
- [x] `AppError` subclasses map to their `statusCode`. Anthropic
      `AnthropicAdminWriteDisabledError` → 422,
      `AnthropicAdminApiError` → 502 (mirror the pattern in
      `admin/users.ts` `provision-claude` route).
- [x] Actor id is sourced from `(req.session as any).userId`.
- [x] Integration tests in
      `tests/server/admin-groups.routes.test.ts` modeled on
      `bulk-cohort.routes.test.ts` — fake the services on
      `registry`, assert status codes and response shapes for each
      endpoint.
- [x] `user-search` returns `[]` on a query shorter than 2 characters
      (service-level behaviour).
- [x] Existing test suite passes unchanged.

## Testing

- **Existing tests to run**: `npm run test:server`.
- **New tests to write**: `admin-groups.routes.test.ts`.
- **Verification command**: `npm run test:server`.
