---
id: '006'
title: "External Source Sync \u2014 Pike13 and Google Workspace"
status: done
branch: sprint/006-pike13-sync-and-write-back
use-cases:
- UC-004
- UC-020
- SUC-001
- SUC-002
- SUC-003
- SUC-004
---

# Sprint 006: External Source Sync — Pike13 and Google Workspace

## Goal

Deliver the full external-source sync layer: import Pike13 person records as
Users, write League email and GitHub handle back to Pike13, and pull the Google
Workspace OU tree into the app (Cohorts from OUs, staff and student Users from
Workspace users). All sync operations are admin-triggered and idempotent.

## Epics

### Epic A: Pike13 Sync (UC-004)
Administrator-triggered sync that paginates Pike13 people, matches against
existing Users by Pike13 ID or email, creates new Users + ExternalAccount
(type=pike13) for unmatched records, runs the merge similarity stub, and
reports created/matched/skipped/error counts.

### Epic B: Pike13 Write-Back (UC-020)
Replace the two stub call sites planted in Sprints 004 and 005. After a
Workspace account becomes active, write the League email to Pike13 "League
Email Address". After a GitHub Login is added, write the GitHub username to
Pike13 "GitHub Username". Write-back failure is logged; the primary action
is not rolled back.

### Epic C: Google Workspace Sync (SUC-001 – SUC-004)
Admin-triggered reads from Google's OU tree and user lists:
- **Sync Cohorts** — read sub-OUs under GOOGLE_STUDENT_OU_ROOT, upsert Cohort
  rows by google_ou_path without calling createOU.
- **Sync Staff** — read users in GOOGLE_STAFF_OU_PATH, upsert Users with
  role=staff; never downgrade an existing admin.
- **Sync Students** — read users in student root and each cohort OU, upsert
  Users with role=student and cohort_id from OU path.
- **Sync All** — run the three above in sequence.
Flag-only removal: ExternalAccount(type=workspace) rows whose email was not
seen are marked status=removed; User rows are never deleted.

## Scope

- `Pike13ApiClient` module: paginate people, read person details, update
  custom fields. Write-enable flag (`PIKE13_WRITE_ENABLED`).
- `Pike13SyncService`: sync logic, upsert Users + ExternalAccount(type=pike13),
  merge similarity stub, audit events, count report.
- `Pike13WritebackService`: real implementation replacing stub module at the
  same import path.
- `GoogleWorkspaceAdminClient` extended with `listOUs(parentPath)`. The
  `listUsersInOU` method already exists.
- `WorkspaceSyncService`: syncCohorts, syncStaff, syncStudents, syncAll.
- `CohortService` extended with `upsertByOUPath(path, name)` — does NOT call
  createOU; used only by WorkspaceSyncService.
- `CreatedVia` enum extended with `workspace_sync`.
- New admin API routes: POST `/admin/sync/pike13`,
  POST `/admin/sync/workspace/cohorts`,
  POST `/admin/sync/workspace/staff`,
  POST `/admin/sync/workspace/students`,
  POST `/admin/sync/workspace/all`.
- New admin UI page: Sync (shows buttons for each action + result counts +
  flagged-for-review list).
- Audit events: sync_started, sync_completed, workspace_sync_flagged per
  flagged ExternalAccount.
- Pike13 custom fields "GitHub Username" and "League Email Address" must be
  pre-created in Pike13 — deployment prerequisite.

## Dependencies

- Sprint 001 (data model, audit service).
- Sprint 002 (auth — admin must be signed in to trigger sync).
- Sprint 004 (Workspace provisioning write-back call site; GoogleWorkspaceAdminClient).
- Sprint 005 (GitHub Login admin-add write-back call site).
- External: Pike13 API credentials; Pike13 custom fields pre-created.
- External: GOOGLE_STAFF_OU_PATH set in env for staff sync.

## Non-Goals

- No Pike13 enrollment, billing, or class scheduling.
- No deprovisioning of Pike13 records.
- No auto-creation of ExternalAccount rows on Workspace user sync (User rows
  only; admins can provision from the user detail view).
- Merge queue logic is still stubbed — Sprint 007 fills it in.
- No scheduled sync (all operations are manually triggered this sprint).

## Rationale

Pike13 and Google Workspace sync share the same "external source → app"
architectural pattern: paginate an external API, match/upsert local rows,
flag removed records, emit audit events. Bundling both in one sprint keeps the
external-sync module pattern consistent and avoids splitting the shared
infrastructure (write-enable flags, count-report shape, admin sync UI) across
two sprints.

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Pike13 API client module | — | 1 |
| 002 | Schema migration: workspace_sync CreatedVia enum value | — | 1 |
| 005 | GoogleWorkspaceAdminClient: add listOUs method | — | 1 |
| 003 | Pike13 sync service and admin sync route | 001 | 2 |
| 004 | Pike13 write-back service: replace stub with real implementation | 001 | 2 |
| 006 | CohortService.upsertByOUPath and WorkspaceSyncService | 002, 005 | 2 |
| 007 | Admin sync routes: Pike13 and Workspace endpoints | 003, 006 | 3 |
| 008 | Admin SyncPanel UI page | 007 | 4 |

**Execution Groups:**
- **Group 1** (parallel): Tickets 001, 002, 005 — independent foundation work
- **Group 2** (parallel after Group 1): Tickets 003, 004, 006 — services built on foundation
- **Group 3** (after Group 2): Ticket 007 — routes that wire services together
- **Group 4** (after Group 3): Ticket 008 — UI that calls the routes
