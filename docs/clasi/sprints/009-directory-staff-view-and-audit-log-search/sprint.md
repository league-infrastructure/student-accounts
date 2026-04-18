---
id: "009"
title: "Directory, Staff View, and Audit Log Search"
status: roadmap
branch: sprint/009-directory-staff-view-and-audit-log-search
use-cases: [UC-022, UC-023]
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

_(To be created when this sprint enters Detail Mode.)_
