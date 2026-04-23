---
id: '010'
title: "Admin Dashboard page — three widgets"
status: done
use-cases:
  - SUC-010-001
  - SUC-010-002
  - SUC-010-005
depends-on:
  - "010-003"
  - "010-006"
github-issue: ''
todo: plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Admin Dashboard page — three widgets

## Description

Create `client/src/pages/admin/Dashboard.tsx` — the admin landing page. It
is rendered at `/` for `role=admin` users (wired in T013).

Three widgets stacked vertically:
1. **Pending Requests** — up to 5 inline rows with Approve/Deny buttons; "See all N" link if > 5.
2. **Cohorts** — compact list of active cohorts with student counts; header links to `/cohorts`.
3. **User Counts by Role** — three cards: Students / Staff / Admins (totals from `GET /api/admin/stats`).

Depends on T003 (stats endpoint) and T006 (AdminOnlyRoute + nav split, so
the sidebar is correct when the Dashboard route is at `/`).

## Acceptance Criteria

- [x] `client/src/pages/admin/Dashboard.tsx` created.
- [x] Pending Requests widget: fetches `GET /api/admin/provisioning-requests?status=pending`. Shows up to 5 rows. Each row shows: user name, email, request type, submitted-at, [Approve] and [Deny] buttons. If total > 5, renders "See all N requests" link to `/requests`.
- [x] Approve/Deny buttons POST to existing `POST /api/admin/provisioning-requests/:id/approve` and `POST /api/admin/provisioning-requests/:id/reject`. On success, re-fetches the pending list.
- [x] Cohorts widget: fetches `GET /api/admin/cohorts`. Renders cohort name and student count. Header "Cohorts" links to `/cohorts`.
- [x] User Counts widget: fetches `GET /api/admin/stats`. Renders three number cards: Total Students, Total Staff, Total Admins.
- [x] Each widget handles its own loading and error state (spinner / inline error message). One widget failing does not break others.
- [x] Component tests covering: pending requests render and Approve action, "See all" visible when > 5, stats cards render correct counts, cohort list renders.
- [x] `npm run test:client` passes.

## Implementation Plan

### New Files

**`client/src/pages/admin/Dashboard.tsx`**

Use React Query for all three fetches:
- `useQuery(['pending-requests'], () => fetch('/api/admin/provisioning-requests?status=pending').then(r => r.json()))`
- `useQuery(['cohorts'], () => fetch('/api/admin/cohorts').then(r => r.json()))`
- `useQuery(['admin-stats'], () => fetch('/api/admin/stats').then(r => r.json()))`

Mutations for approve/deny use `useMutation` + `queryClient.invalidateQueries(['pending-requests'])`.

Pending Requests widget renders the first 5 items of the fetched array, with a
conditional "See all" link showing total count.

User Counts widget renders `stats.totalStudents`, `stats.totalStaff`,
`stats.totalAdmins` as three bordered cards.

Cohorts widget renders cohort name + `_count.users` (or whatever the cohort
endpoint returns for student count — check existing `Cohorts.tsx` for the
response shape).

### Testing Plan

**`tests/client/pages/admin/Dashboard.test.tsx`**

Mock fetch responses. Test scenarios:
- 3 pending requests → all 3 rendered, no "See all".
- 7 pending requests → 5 rendered, "See all 7 requests" visible.
- Stats render correct numbers.
- Click Approve → confirm POST URL, widget re-fetches.
- Widget error state: stats fetch fails → other widgets still render.

Run `npm run test:client`.
