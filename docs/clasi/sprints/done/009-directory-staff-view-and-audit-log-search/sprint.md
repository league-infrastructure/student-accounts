---
id: 009
title: Directory, Staff View, and Audit Log Search
status: done
branch: sprint/009-directory-staff-view-and-audit-log-search
use-cases:
- UC-022
- UC-023
- SUC-009-001
- SUC-009-002
- SUC-009-003
- SUC-009-004
- SUC-009-005
- SUC-009-006
- SUC-009-007
- SUC-009-008
- SUC-009-009
---

# Sprint 009: Directory, Staff View, and Audit Log Search

## Goal

Deliver the admin user directory with search and filter, the staff read-only
directory view, and the searchable audit log — the final polish sprint that
makes all accumulated data queryable and navigable.

## Use Cases Delivered

- **UC-022** — Staff read-only directory: org-wide student list; search and
  filter by name, cohort, External Account status; student profile view
  (status only, no actions); 403 block on any write attempt.
- **UC-023** — Audit log search: filter by target user, actor, action type,
  and date range; reverse chronological display; full details JSON on click.

## Scope

- Admin user directory: searchable and filterable list of all Users;
  filters by cohort, role, and External Account status (has Workspace,
  has Claude seat, has Pike13 link); links to existing user detail view
  (built in Sprint 005).
- Staff directory view: same query surface as admin directory but read-only;
  no provisioning, merge, cohort-management, or audit-log actions exposed;
  role guard enforces this at both UI and API layer.
- Audit log page: filter form (user, actor, action type, date range); paginated
  results table; detail drill-down; appropriate DB indexes for query
  performance.
- Role-based routing: ensure staff, student, and admin see correct landing
  pages; clean up any placeholder redirects from Sprint 002.

## Dependencies

- Sprint 001 (AuditEvent entity and indexes).
- Sprint 002 (auth and role detection, including staff role).
- Sprints 003–008 (all data being queried and displayed exists by now).

## Non-Goals

- No data export or reporting (not in spec).
- No audit log write or deletion (read-only view).
- No per-cohort restriction on staff visibility (spec decision 3 explicitly
  removes this restriction — staff see all students org-wide).

## Rationale

This sprint is last because it queries data produced by every other sprint.
Running it earlier would mean building filters and views over an incomplete
dataset. Placing it at the end also means the audit log has accumulated
real entries from all previous sprints' integration testing, giving the
search UI a realistic workload to test against.

## Tickets

| # | Title | Depends On | Group |
|---|-------|-----------|-------|
| T001 | Extend GET /admin/users to include externalAccountTypes | — | 1 |
| T002 | Expose pike13Client on ServiceRegistry and add GET /admin/users/:id/pike13 | — | 1 |
| T003 | Add DELETE /admin/users/:id (soft-delete) with AuditEvent | — | 1 |
| T004 | Add GET /api/staff/directory route with requireRole(staff) guard | — | 1 |
| T005 | Add GET /admin/audit-log route with filters and pagination | — | 1 |
| T006 | Overhaul UsersPanel: search, filter dropdown, sortable columns, prettifyName, name/email links | T001 | 2 |
| T007 | Add row checkboxes, bulk-delete toolbar, and three-dot actions menu to UsersPanel | T003, T006 | 3 |
| T008 | Add Pike13 snippet section and Unlink/copy fixes to UserDetailPanel | T002 | 2 |
| T009 | Build StaffLayout and StaffDirectory page (read-only student listing) | T004 | 2 |
| T010 | Build AuditLogPanel page with filter form, paginated results, and detail expansion | T005 | 2 |
| T011 | Wire routes, App.tsx, AppLayout nav, and fix role-based post-login redirects | T004–T010 | 4 |

**Execution groups:**
- **Group 1** (parallel): T001, T002, T003, T004, T005 — all server-side foundation work, no dependencies.
- **Group 2** (parallel): T006, T008, T009, T010 — client and detail pages that depend on Group 1.
- **Group 3** (after T003+T006): T007 — bulk/row actions that need both the delete endpoint and the overhauled panel.
- **Group 4** (after all): T011 — integration wiring and routing.
