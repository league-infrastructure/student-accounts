---
id: '006'
title: AdminOnlyRoute component and AppLayout nav split
status: done
use-cases:
  - SUC-010-001
depends-on: []
github-issue: ''
todo: plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# AdminOnlyRoute component and AppLayout nav split

## Description

Two closely related client-side changes that unblock the Dashboard ticket (T010)
and the route table ticket (T013):

1. **`AdminOnlyRoute`**: New route guard component. Renders `<Outlet />` for
   `role=admin`; redirects others to `/account`.

2. **AppLayout nav split**: The current `ADMIN_NAV` array in `AppLayout.tsx`
   contains both admin-workflow pages (Requests, Cohorts, Users, etc.) and
   ops-only pages (Environment, DB, Logs, etc.). Split these: admin-workflow
   links appear in the main sidebar nav (shown when `role=admin`, outside
   the `/admin/*` section); ops-only links stay in `ADMIN_NAV` for the
   `/admin/*` section.

## Acceptance Criteria

- [x] `client/src/components/AdminOnlyRoute.tsx` created. Renders `<Outlet />` for `role=admin`, redirects to `/account` for any other role (including unauthenticated).
- [x] `AppLayout.tsx` defines a new `ADMIN_WORKFLOW_NAV` array containing: Dashboard (`/`, `end: true`), Provisioning Requests (`/requests`), Cohorts (`/cohorts`), Users (`/users`), Sync (`/sync`), Merge Queue (`/merge-queue`).
- [x] `ADMIN_NAV` (ops-only) retains: Environment, Database, Logs, Sessions, Scheduled Jobs, Configuration, Import/Export. Removes the moved items.
- [x] When `user.role === 'admin'` and the current path is NOT under `/admin/*`, `ADMIN_WORKFLOW_NAV` items are rendered in the sidebar.
- [x] When the current path IS under `/admin/*`, the existing `ADMIN_NAV` (ops-only) items render as before.
- [x] The "Admin" link at the bottom of the sidebar (for admins) now links to `/admin/env` or another ops entry point (not `/admin/users` which has moved). Update as appropriate.
- [x] Non-admin users do not see `ADMIN_WORKFLOW_NAV` items.
- [x] `npm run test:client` passes.

## Implementation Plan

### New Files

**`client/src/components/AdminOnlyRoute.tsx`**
```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminOnlyRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role !== 'admin') return <Navigate to="/account" replace />;
  return <Outlet />;
}
```

### Files to Modify

**`client/src/components/AppLayout.tsx`**

1. Define `ADMIN_WORKFLOW_NAV` array with the 6 admin-workflow items.
2. Remove those 6 items from `ADMIN_NAV`.
3. In the sidebar render logic, when `isAdmin && !isAdminSection`, render
   `ADMIN_WORKFLOW_NAV` items in the primary nav section (after MAIN_NAV items).
4. The "Admin" bottom-of-sidebar link: update target from `/admin/users` to
   `/admin/env` (or keep as a general "Ops" link).

Study the current `primaryNav` logic carefully — it switches between `ADMIN_NAV`
and `MAIN_NAV` based on `isAdminSection`. The new nav is additive: when not in
the admin section and the user is an admin, append `ADMIN_WORKFLOW_NAV` to
`MAIN_NAV`.

### Testing Plan

- `npm run test:client` — existing component tests must pass.
- New tests for `AdminOnlyRoute`: renders outlet for admin, redirects for student, redirects for staff.
- Manual: log in as admin → sidebar shows Dashboard, Requests, Cohorts, Users, Sync, Merge Queue. Click Admin link → sidebar switches to ops-only list.
