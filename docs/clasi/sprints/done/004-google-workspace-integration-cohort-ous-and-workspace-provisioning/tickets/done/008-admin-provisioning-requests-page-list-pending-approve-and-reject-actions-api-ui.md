---
id: 008
title: "Admin provisioning-requests page \u2014 list pending, approve, and reject\
  \ actions (API + UI)"
status: done
use-cases:
- UC-005
depends-on:
- '006'
- '007'
github-issue: ''
todo: ''
---

# Admin provisioning-requests page — list pending, approve, and reject actions (API + UI)

## Description

This ticket delivers the admin-facing provisioning request management UI
described in SUC-003. An administrator with `role=admin` can view all pending
provisioning requests and approve or reject them.

The scope is deliberately minimal: a flat list, no pagination, no filtering.
The goal is functional admin approval, not a polished admin dashboard.

This ticket depends on T006 (so admins can sign in) and T007 (so approval
actually provisions the account).

## Acceptance Criteria

### API

- [x] Route file `server/src/routes/admin/provisioning-requests.ts` is created
      and mounted in `app.ts` at `/admin` prefix.
- [x] All routes in this module apply `requireAuth` + `requireRole('admin')`.
- [x] `GET /admin/provisioning-requests` — returns all ProvisioningRequests
      with `status='pending'`, joined with the requesting user's `display_name`
      and `primary_email`. Response is a JSON array.
      Response item shape: `{ id, userId, userName, userEmail, requestedType, createdAt }`.
- [x] `POST /admin/provisioning-requests/:id/approve` — calls
      `ProvisioningRequestService.approve(id, req.session.userId)`. Returns 200
      with the updated request on success. Returns 422 with an error message
      if provisioning preconditions fail (no cohort, account exists, etc.).
      Returns 502 if the Google Admin SDK call fails (surface the error message;
      do not expose raw SDK details).
- [x] `POST /admin/provisioning-requests/:id/reject` — calls
      `ProvisioningRequestService.reject(id, req.session.userId)`. Returns 200
      on success.
- [x] Non-admin request to any of these routes returns 403.

### UI

- [x] React component `client/src/pages/admin/ProvisioningRequests.tsx` is
      created.
- [x] Route `/admin/provisioning-requests` is added to `client/src/App.tsx`,
      guarded to render only when `session.role === 'admin'`.
- [x] Component fetches pending requests from `GET /admin/provisioning-requests`
      using React Query `useQuery`.
- [x] Displays a table with columns: Student Name, Email, Request Type,
      Requested On, Actions (Approve / Reject buttons).
- [x] "Approve" button: calls `POST /admin/provisioning-requests/:id/approve`.
      On success: removes the row from the list (invalidate query). On failure:
      shows inline error message next to the row (not a page-level error).
- [x] "Reject" button: calls `POST /admin/provisioning-requests/:id/reject`.
      On success: removes the row. No confirmation dialog needed (this sprint).
- [x] Empty state: "No pending provisioning requests." message when list is
      empty.
- [x] Loading state while the query is in flight.
- [x] No pagination (flat list is acceptable for this sprint).

### Navigation

- [x] A link to `/admin/provisioning-requests` is added to the admin navigation
      area (even if it is just a plain `<a>` tag in a minimal header or sidebar
      stub).

### Tests

- [x] `GET /admin/provisioning-requests` returns 403 for non-admin user.
- [x] `GET /admin/provisioning-requests` returns 200 with pending requests for admin.
- [x] `POST /admin/provisioning-requests/:id/approve` returns 403 for non-admin.
- [x] `POST /admin/provisioning-requests/:id/approve` returns 200 on success
      (using `FakeGoogleWorkspaceAdminClient`).
- [x] `POST /admin/provisioning-requests/:id/reject` returns 200 on success.
- [x] `npm test` passes.

## Implementation Plan

### Approach

Follow the existing route pattern: thin handler, service calls, service registry
access via `req.services`. The UI component follows the `AccountPage` pattern
from Sprint 003: React Query for data, inline error handling per mutation.

### Files to Create

- `server/src/routes/admin/provisioning-requests.ts`
- `client/src/pages/admin/ProvisioningRequests.tsx`

### Files to Modify

- `server/src/app.ts` — mount the new admin provisioning-requests router.
- `client/src/App.tsx` — add `/admin/provisioning-requests` route.

### Testing Plan

Route-level integration tests (Supertest), not component tests. Test role
guards, success paths, and error propagation. Component behavior is verified
by manual testing in this sprint (UI testing infrastructure is not yet defined).

### Documentation Updates

None beyond the sprint artifacts.
