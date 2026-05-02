---
id: "024"
title: "User Management list polish - restructure sidebar add search and sortable columns"
status: planning
branch: sprint/024-user-management-list-polish-restructure-sidebar-add-search-and-sortable-columns
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
  - SUC-006
  - SUC-007
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 024: User Management list polish - restructure sidebar, add search and sortable columns

## Goals

Restructure the User Management sidebar group to match the stakeholder's
intended mental model, consolidate the all-users page, and bring every
list panel up to a consistent level of polish: search bar, sortable
column headers, and a Joined (creation date) column where applicable.

## Problem

The sidebar order and labels do not match the stakeholder's hierarchy.
"Users" currently routes to a staff-filtered panel; the true all-users
panel (UsersPanel.tsx) lives at a redirect path and would be deleted
once the correct page takes over `/admin/users`. Several list panels
(Students, Staff, LLM Proxy Users, Cohorts, Groups) lack a search bar
or sortable headers, making it hard to locate specific records as the
data grows.

## Solution

1. Reorder and relabel the User Management sidebar group:
   Users -> Students -> Staff -> LLM Proxy Users -> Groups -> Cohorts.
   Rename "Staff Directory" to "Staff" and "League Students" to "Students".
2. Replace AdminUsersPanel at `/admin/users` with the logic from
   UsersPanel.tsx (all users, search, sort, Joined column, filter
   dropdown), and absorb AdminUsersPanel's make-admin / remove-admin
   per-row action into the unified page. Delete UsersPanel.tsx once no
   callers remain.
3. Add a search bar and sortable column headers to StudentAccountsPanel,
   StaffDirectory, LlmProxyUsersPanel, Cohorts, and Groups.

## Success Criteria

- Sidebar shows items in the correct order with the correct labels.
- `/admin/users` shows all users, supports search, sort, and Joined column,
  and includes the make-admin / remove-admin action per row for staff users.
- Every list panel has a functional search bar.
- Students, Staff, LLM Proxy Users, Cohorts, and Groups panels have
  sortable column headers.
- StudentAccountsPanel and StaffDirectory show a Joined column.
- All relevant tests pass.

## Scope

### In Scope

- `client/src/components/AppLayout.tsx` — reorder and relabel the User
  Management group; update `defaultTo` to `/admin/users`.
- `client/src/pages/admin/AdminUsersPanel.tsx` — replace with all-users
  logic ported from UsersPanel.tsx; integrate make-admin action.
- `client/src/pages/admin/UsersPanel.tsx` — delete after AdminUsersPanel
  is updated (no remaining callers).
- `client/src/pages/admin/StudentAccountsPanel.tsx` — add search bar and
  sortable column headers.
- `client/src/pages/staff/StaffDirectory.tsx` — add Joined column and
  sortable column headers (existing search and filter controls preserved).
- `client/src/pages/admin/LlmProxyUsersPanel.tsx` — add search bar and
  sortable column headers.
- `client/src/pages/admin/Cohorts.tsx` — add search bar (sort already
  present).
- `client/src/pages/admin/Groups.tsx` — add search bar (sort already
  present).
- Tests for AppLayout (sidebar order/labels), UsersPanel (now merged into
  AdminUsersPanel), and each modified panel.

### Out of Scope

- Backend search/sort query parameters or pagination.
- Extracting a shared `<DataTable>` component (noted as a future TODO).
- Route renames.
- Any changes to the Admin ops group or other sidebar sections.

## Test Strategy

- Update `AppLayout.test.tsx` for new sidebar labels and order.
- Update `UsersPanel.test.tsx` or merge its coverage into an
  `AdminUsersPanel.test.tsx` after the consolidation.
- Add or update tests for each panel that gains search / sort.
- Manual smoke test (ticket 008) performed by the stakeholder before close.

## Architecture Notes

All filtering and sorting remain client-side. List sizes are small enough
that server-side query params are not needed. A shared `<DataTable>`
component is intentionally deferred — each panel gets the same pattern
inline this sprint, making extraction straightforward in a future sprint.

## GitHub Issues

(None linked.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Sidebar restructure — reorder and relabel User Management | — | 1 |
| 002 | Replace AdminUsersPanel with all-users view | — | 1 |
| 003 | StudentAccountsPanel — add search and sortable headers | — | 1 |
| 004 | StaffDirectory — add Joined column and sortable headers | — | 1 |
| 005 | LlmProxyUsersPanel — add search and sortable headers | — | 1 |
| 006 | Cohorts — add search bar | — | 1 |
| 007 | Groups — add search bar | — | 1 |
| 008 | Manual smoke — stakeholder verification | 001, 002, 003, 004, 005, 006, 007 | 2 |

**Groups**: Tickets 001–007 are independent and can execute in parallel
(Group 1). Ticket 008 requires all of Group 1 to be done first (Group 2).
