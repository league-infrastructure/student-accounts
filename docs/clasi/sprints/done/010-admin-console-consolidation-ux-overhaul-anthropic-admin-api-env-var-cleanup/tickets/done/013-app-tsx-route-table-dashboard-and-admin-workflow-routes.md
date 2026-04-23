---
id: '013'
title: "App.tsx route table \u2014 Dashboard and admin-workflow routes"
status: done
use-cases:
- SUC-010-001
depends-on:
- 010-006
- 010-010
github-issue: ''
todo: plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# App.tsx route table — Dashboard and admin-workflow routes

## Description

Update `client/src/App.tsx` to:
1. Add a new `<AdminOnlyRoute>` group at the top level of `AppLayout` containing
   the Dashboard at `/` and admin-workflow pages at their new top-level paths.
2. Change the existing `/` redirect (`<Navigate to="/account" replace />`) to
   only apply to non-admin users (or let `AdminOnlyRoute` handle the redirect
   logic and remove the static Navigate).
3. Keep all existing `/admin/*` routes under `AdminLayout` unchanged.

Depends on T006 (`AdminOnlyRoute` component) and T010 (`Dashboard.tsx`).

## Acceptance Criteria

- [x] `App.tsx` imports `AdminOnlyRoute` and `Dashboard`.
- [x] An `<AdminOnlyRoute>` group exists inside `<AppLayout>` with these routes:
  - `path="/"` → `<Dashboard />` (with `end` flag or exact match)
  - `path="/requests"` → `<ProvisioningRequests />`
  - `path="/cohorts"` → `<Cohorts />`
  - `path="/users"` → `<UsersPanel />`
  - `path="/users/:id"` → `<UserDetailPanel />`
  - `path="/sync"` → `<SyncPanel />`
  - `path="/merge-queue"` → `<MergeQueuePanel />`
- [x] Non-admin users navigating to `/` see `<Account />` (existing behaviour preserved — the current `<Navigate to="/account" />` should remain as the default for non-admin users; `AdminOnlyRoute` redirects admins to its contents and non-admins to `/account`).
- [x] All existing `/admin/*` routes under `AdminLayout` remain unchanged and functional.
- [x] `npm run test:client` passes.

## Implementation Plan

### Files to Modify

**`client/src/App.tsx`**

Current structure at `/`:
```tsx
<Route path="/" element={<Navigate to="/account" replace />} />
```

New structure: The `AdminOnlyRoute` guard renders `<Outlet />` for admins and
`<Navigate to="/account" />` for others. So the `/` route should render
`<Dashboard />` inside `AdminOnlyRoute`, and the existing Navigate for non-admins
is handled by `AdminOnlyRoute` itself. Remove or adjust the existing Navigate
for `/` to avoid conflicts.

Add after the existing `<Route path="/account" ...>`:
```tsx
<Route element={<AdminOnlyRoute />}>
  <Route path="/" element={<Dashboard />} />
  <Route path="/requests" element={<ProvisioningRequests />} />
  <Route path="/cohorts" element={<Cohorts />} />
  <Route path="/users" element={<UsersPanel />} />
  <Route path="/users/:id" element={<UserDetailPanel />} />
  <Route path="/sync" element={<SyncPanel />} />
  <Route path="/merge-queue" element={<MergeQueuePanel />} />
</Route>
```

Remove the old `<Route path="/" element={<Navigate to="/account" replace />} />`
since `AdminOnlyRoute` handles non-admin users at `/` by redirecting to `/account`.

**Important:** The existing `/admin/users`, `/admin/users/:id`,
`/admin/provisioning-requests`, `/admin/cohorts`, `/admin/sync`,
`/admin/merge-queue` routes inside `AdminLayout` should be **removed** from
`App.tsx` since those pages are now at the top-level paths. Leaving them in
would create duplicate routes. Confirm by checking what routes `AdminLayout`
wraps currently.

### Testing Plan

- `npm run test:client` — existing tests must pass.
- Manual: log in as admin → lands on Dashboard at `/`. Navigate to `/requests` → Provisioning Requests page loads. Navigate to `/admin/env` → Environment info still works.
- Manual: log in as student → `/` redirects to `/account`. `/requests` redirects to `/account`.
