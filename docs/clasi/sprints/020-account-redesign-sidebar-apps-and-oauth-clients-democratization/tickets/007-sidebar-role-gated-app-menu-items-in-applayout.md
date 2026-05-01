---
id: "007"
title: "Sidebar role-gated app menu items in AppLayout"
status: todo
use-cases:
  - SUC-020-002
depends-on:
  - "001"
  - "005"
  - "006"
github-issue: ""
todo: "plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sidebar role-gated app menu items in AppLayout

## Description

Populate the standalone sidebar in `AppLayout` with role-gated app
links so every authenticated user reaches their entitled sub-apps
without going through `/account`. See `architecture-update.md` §
"Modified Modules (Client)" and use case **SUC-020-002**.

**Role helper.** Add `hasStaffAccess(role: string | undefined): boolean`
to `client/src/lib/roles.ts` — returns `true` for `'staff'` or
`'admin'`. Sits next to the existing `hasAdminAccess` (line ~24).

**Nav config.** In `client/src/components/AppLayout.tsx`, the current
`MAIN_NAV` is empty (line 20) and there is an `ADMIN_WORKFLOW_NAV` that
only renders when in `/admin/*`. Reshape so a single role-aware nav
config drives the sidebar everywhere. Items and gates:

| Item | Path | Visible to |
|---|---|---|
| Account | `/account` | always |
| Services | `/services` | always |
| OAuth Clients | `/oauth-clients` | always |
| Staff Directory | `/staff` (use existing path) | `hasStaffAccess(role)` |
| User Management | `/admin/users` (or existing path) | `hasStaffAccess(role)` |
| Cohorts | `/admin/cohorts` (existing) | `hasAdminAccess(role)` |
| Groups | `/admin/groups` (existing) | `hasAdminAccess(role)` |

(Confirm the actual current paths via `App.tsx` before wiring — do
not invent paths.)

Implementation can either (a) extend `MAIN_NAV` to a list of
`{ to, label, gate?: (role) => boolean }` and filter at render, or
(b) build an array inline in the component using the role helpers.
Match the existing pattern style for consistency.

**Drop the `!isAdminSection` gate.** Today
`AppLayout.tsx` line ~301 sets `isAdminSection = pathname.startsWith('/admin/')`
and uses it (line ~365) to swap between `MAIN_NAV` and admin-ops nav,
which has the side-effect of hiding User Management / Cohorts / Groups
/ Staff Directory from the standalone sidebar elsewhere. Remove that
hide behaviour: in the standalone sidebar, the role-gated items
should appear regardless of current path. The admin-ops nav (the
ops-only items shown only inside `/admin/*`) can stay as-is — this
ticket is about the *primary* nav.

Also drop the `!isAdminSection` clause on the staff-only bottom nav
clause around line 503 if it has the same effect (verify; preserve
intent).

## Acceptance Criteria

- [ ] `hasStaffAccess(role)` exported from `client/src/lib/roles.ts`; returns `true` for `'staff'` and `'admin'`, `false` otherwise.
- [ ] Sidebar shows Account, Services, OAuth Clients to every authenticated user, on every route under `AppLayout` (not just outside `/admin/*`).
- [ ] Sidebar adds Staff Directory + User Management for staff/admin.
- [ ] Sidebar adds Cohorts + Groups for admin only.
- [ ] No item paths are invented — every `to` corresponds to a real route in `App.tsx`.
- [ ] `npm run test:client` passes; `AppLayout.test.tsx` covers per-role visibility.

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write** (extend `tests/client/AppLayout.test.tsx`):
  - Student user sees Account, Services, OAuth Clients only — no Staff Directory, no admin items.
  - Staff user sees the always-on items plus Staff Directory + User Management; does NOT see Cohorts / Groups.
  - Admin user sees all seven items.
  - Visiting `/admin/cohorts` (or another admin route) still shows the always-on items in the sidebar — i.e. the `!isAdminSection` hide behaviour is gone.
  - `OAuth Clients` is visible to a student (regression for SUC-020-002 acceptance).
  - Unit test for `hasStaffAccess`: `'staff' → true`, `'admin' → true`, `'student' → false`, `undefined → false`.
- **Verification command**: `npm run test:client -- AppLayout`
