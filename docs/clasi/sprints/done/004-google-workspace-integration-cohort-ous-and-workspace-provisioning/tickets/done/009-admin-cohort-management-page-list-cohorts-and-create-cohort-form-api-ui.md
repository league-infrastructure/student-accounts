---
id: 009
title: "Admin cohort management page \u2014 list cohorts and create cohort form (API\
  \ + UI)"
status: done
use-cases:
- UC-012
depends-on:
- '005'
- '006'
github-issue: ''
todo: ''
---

# Admin cohort management page — list cohorts and create cohort form (API + UI)

## Description

This ticket delivers the admin-facing cohort management page described in
SUC-001 and spec §5.3. An administrator can view all cohorts and create a
new one (which creates the corresponding Google OU via T005).

Scope is minimal: a flat cohort list and a simple create form. No cohort
editing, deletion, or student assignment UI this sprint.

This ticket depends on T005 (CohortService.createWithOU) and T006 (admin role
assignment so admin can access the page).

## Acceptance Criteria

### API

- [x] Route file `server/src/routes/admin/cohorts.ts` is created and mounted
      in `app.ts` at `/admin` prefix.
- [x] All routes apply `requireAuth` + `requireRole('admin')`.
- [x] `GET /admin/cohorts` — returns all Cohorts, ordered by `created_at` desc.
      Response item shape: `{ id, name, google_ou_path, createdAt }`.
- [x] `POST /admin/cohorts` — accepts `{ name: string }` in the request body.
      Calls `CohortService.createWithOU(name, req.session.userId)`. Returns 201
      with the new Cohort on success. Returns 409 if name is duplicate. Returns
      422 if name is blank. Returns 502 if the Admin SDK fails (surface error
      message without raw SDK detail).
- [x] Non-admin request returns 403.

### UI

- [x] React component `client/src/pages/admin/Cohorts.tsx` is created.
- [x] Route `/admin/cohorts` added to `client/src/App.tsx`, guarded for
      `session.role === 'admin'`.
- [x] Component fetches cohorts from `GET /admin/cohorts` using React Query.
- [x] Displays a table with columns: Name, Google OU Path, Created On.
- [x] "Create Cohort" button or form at the top: text input for name,
      submit button.
- [x] On form submit: calls `POST /admin/cohorts`. On success: adds the new
      cohort to the list (invalidate query). On failure: shows inline error
      (e.g., "A cohort with this name already exists").
- [x] Empty state: "No cohorts yet." when list is empty.
- [x] Loading state while query is in flight.
- [x] A link to `/admin/cohorts` in the admin navigation area.

### Tests

- [x] `GET /admin/cohorts` returns 403 for non-admin.
- [x] `GET /admin/cohorts` returns 200 with cohort list for admin.
- [x] `POST /admin/cohorts` returns 403 for non-admin.
- [x] `POST /admin/cohorts` with valid name returns 201 (using
      `FakeGoogleWorkspaceAdminClient`).
- [x] `POST /admin/cohorts` with blank name returns 422.
- [x] `POST /admin/cohorts` with duplicate name returns 409.
- [x] `npm test` passes.

## Implementation Plan

### Approach

Same pattern as T008. Thin route handlers, service registry access. React
component follows `AccountPage` patterns.

### Files to Create

- `server/src/routes/admin/cohorts.ts`
- `client/src/pages/admin/Cohorts.tsx`

### Files to Modify

- `server/src/app.ts` — mount admin cohorts router.
- `client/src/App.tsx` — add `/admin/cohorts` route.

### Testing Plan

Route-level integration tests (Supertest). Same approach as T008: test role
guards, success paths, validation errors, and SDK failure path.

### Documentation Updates

None beyond sprint artifacts.
