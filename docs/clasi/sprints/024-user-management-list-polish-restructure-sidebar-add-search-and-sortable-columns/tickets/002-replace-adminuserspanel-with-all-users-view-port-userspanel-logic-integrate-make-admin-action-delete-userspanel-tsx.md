---
id: '002'
title: "Replace AdminUsersPanel with all-users view \u2014 port UsersPanel logic,\
  \ integrate make-admin action, delete UsersPanel.tsx"
status: done
use-cases:
- SUC-002
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---

# Replace AdminUsersPanel with all-users view — port UsersPanel logic, integrate make-admin action, delete UsersPanel.tsx

## Description

`AdminUsersPanel.tsx` currently shows only staff-filtered users. The
stakeholder expects `/admin/users` to show every user in the system.

`UsersPanel.tsx` already has the correct shape: all users, search bar,
filter dropdown, sortable column headers (including Joined), row action
menu (Edit, Delete, Impersonate), and bulk selection. It is not routed
anywhere in `App.tsx` — the `/users` redirect already points to
`AdminUsersPanel`.

This ticket:

1. Rewrites `AdminUsersPanel.tsx` by porting the logic from `UsersPanel.tsx`.
2. Absorbs the make-admin / remove-admin action from the old panel into
   the row action menu as a new item, restricted to rows whose role is
   STAFF or ADMIN.
3. Deletes `UsersPanel.tsx` (no callers remain in `App.tsx`).
4. Deletes or migrates `UsersPanel.test.tsx` into `AdminUsersPanel.test.tsx`.

The make-admin mutation (`PUT /api/admin/users/:id` with `{ role }`) and
its guards (self-demotion blocked, last-admin blocked) are preserved from
the old AdminUsersPanel.

## Acceptance Criteria

- [x] `/admin/users` shows all active users (not filtered to staff).
- [x] Search bar filters by name or email (client-side, real-time).
- [x] Filter dropdown supports All / Admin & Staff / Students / by account
      type / by cohort (ported from UsersPanel).
- [x] Column headers Name, Email, Cohort, Accounts, Joined are all sortable.
- [x] Row action menu includes Edit, Delete, Impersonate, and (for
      staff/admin rows only) a "Make admin" / "Remove admin" toggle.
- [x] Self-demotion button is disabled; attempting via API returns 403.
- [x] Last-admin demotion button is disabled; attempting via API returns 409.
- [x] Bulk selection and bulk delete work as before.
- [x] `UsersPanel.tsx` is deleted; no import of it remains in the codebase.
- [x] `UsersPanel.test.tsx` is deleted or migrated; test coverage for the
      new AdminUsersPanel is present in `AdminUsersPanel.test.tsx`.
- [x] `npm run test:client` passes.

## Implementation Plan

### Approach

Copy the full body of `UsersPanel.tsx` into `AdminUsersPanel.tsx`,
replacing the old component. Then integrate the make-admin mutation:

- Add a `setRole` helper (already present in the old AdminUsersPanel).
- Add a `useMutation` for role toggling.
- In `RowMenu`, add a "Make admin" / "Remove admin" item that is only
  rendered when the row user holds role STAFF or ADMIN.
- The button is disabled for self-rows and when the user is the last admin.

The `adminCount` guard (last-admin check) counts rows where
`role === 'ADMIN'` in the full user list — still correct because the
data set is the same `/api/admin/users` response.

### Files to Create / Modify

- `client/src/pages/admin/AdminUsersPanel.tsx` — full rewrite.
- `client/src/pages/admin/UsersPanel.tsx` — DELETE.
- `tests/client/UsersPanel.test.tsx` — DELETE (migrate relevant coverage).
- `tests/client/AdminUsersPanel.test.tsx` — CREATE with coverage for:
  - Renders all users (not filtered to staff).
  - Search bar filters by name or email.
  - Make-admin / remove-admin action appears on staff/admin rows only.
  - Self-demotion button is disabled.

### Testing Plan

1. Delete `tests/client/UsersPanel.test.tsx` after migrating any unique
   test scenarios to `AdminUsersPanel.test.tsx`.
2. Create `tests/client/AdminUsersPanel.test.tsx` with mocked
   `/api/admin/users` and `/api/admin/cohorts` responses.
3. Run `npm run test:client`.
4. Confirm `grep -r "from.*UsersPanel" client/src` returns no results.

### Documentation Updates

None beyond what is already in the architecture update.
