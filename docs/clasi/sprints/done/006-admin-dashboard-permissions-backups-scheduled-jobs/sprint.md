---
id: '006'
title: "Admin Dashboard \u2014 Permissions, Backups, Scheduled Jobs"
status: done
branch: sprint/006-admin-dashboard-permissions-backups-scheduled-jobs
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
---

# Sprint 006: Admin Dashboard — Permissions, Backups, Scheduled Jobs

## Goals

Add three new admin panels (Permissions, Backup/Export, Scheduled Jobs),
enhance two existing panels (Environment, Sessions), and add the
`ScheduledJob` and `RoleAssignmentPattern` models to Prisma. This sprint
completes the admin dashboard feature set needed for the template.

## Problem

The admin dashboard currently lacks several features required for a
production-ready template: there is no way to configure role assignment
rules for OAuth users, no database backup or export capability, and no
mechanism for running scheduled jobs. The Environment panel does not
show integration configuration status, and the Session panel does not
display linked user information. Administrators must perform these tasks
manually or through direct database access.

## Solution

Build out the remaining admin panels and supporting backend infrastructure:

1. **Permissions panel** — Create a `RoleAssignmentPattern` model that
   stores email-match or regex patterns for auto-assigning roles on OAuth
   login. Build an admin UI to manage these patterns.
2. **Backup/Export panel** — Create a `BackupService` that supports JSON
   export of database contents, `pg_dump`-based full backups, and
   list/restore/delete operations. Build an `ImportExport` admin panel.
3. **Scheduled Jobs panel** — Create a `ScheduledJob` model and
   `SchedulerService` with a tick mechanism, handler registration, manual
   run-now support, and `FOR UPDATE SKIP LOCKED` concurrency control.
   Build a `ScheduledJobsPanel` admin UI. Seed default jobs
   (`daily-backup`, `weekly-backup`).
4. **Environment panel enhancements** — Add integration configuration
   status showing which OAuth providers and API keys are configured.
5. **Session panel enhancements** — Show linked user information instead
   of raw session data.

## Depends On

- **Sprint 005** (Auth System & User Management) — provides the `User`
  model, `UserService`, OAuth-to-database upsert, role-based auth
  middleware (`requireAuth`, `requireAdmin`), and the `UserRole` enum
  that this sprint's permissions system builds on.
- **Sprint 004** (Infrastructure) — provides the `ServiceRegistry`
  pattern that `BackupService` and `SchedulerService` register into.

## Success Criteria

- Permissions panel loads and allows creating, editing, and deleting
  role assignment patterns
- Role assignment patterns are applied on OAuth login (matching users
  receive the configured role)
- Admin can create a JSON export and download it
- Admin can create a `pg_dump` backup, list backups, restore from a
  backup, and delete backups
- Scheduled jobs panel lists jobs with status, frequency, last/next run
- Admin can enable, disable, and manually run scheduled jobs
- Seeded `daily-backup` and `weekly-backup` jobs appear on first run
- Scheduler tick executes due jobs automatically
- Environment panel shows integration config status
- Session panel shows linked user info
- All admin API routes enforce admin-only access (403 for non-admin)
- All new admin API routes have tests

## Scope

### In Scope

- `RoleAssignmentPattern` Prisma model and migration
- `ScheduledJob` Prisma model and migration
- `BackupService` — JSON export, `pg_dump` backup, list/restore/delete
- `SchedulerService` — tick, registerHandler, runJobNow, FOR UPDATE
  SKIP LOCKED
- Admin API routes for permissions, backups, and scheduled jobs
- `PermissionsPanel.tsx` React component
- `ImportExport.tsx` React component
- `ScheduledJobsPanel.tsx` React component
- Seed default scheduled jobs (`daily-backup`, `weekly-backup`)
- `SessionService` — session queries with linked user info, registered
  in ServiceRegistry
- Enhance `EnvironmentPanel` with integration config status
- Enhance `SessionPanel` with linked user info (via SessionService)
- Verify existing Configuration panel and Log Viewer panels
- Verify OAuth integrations still work after Sprint 005 auth changes
- Admin API tests for all new endpoints
- Local dev verification only

### Out of Scope

- S3 or remote backup storage (backups stored locally)
- Cron-style schedule expressions (simple frequency strings only)
- WebSocket-based real-time updates (panels use polling/refresh)
- Production deployment changes
- Client-side unit tests (deferred to sprint 007)
- Changes to existing auth flow beyond applying role assignment patterns

## Test Strategy

Server-side tests using Jest + Supertest, following the project's
established patterns:

- **Auth bypass**: Use `POST /api/auth/test-login` with admin role to
  authenticate test requests. Never mock session middleware.
- **Supertest agents**: Use `request.agent(app)` to maintain session
  cookies across requests.
- **Database assertions**: Assert both HTTP responses and database state
  via Prisma queries for all mutation endpoints.
- **Admin access control**: Verify all admin routes return 403 for
  non-admin users and 401 for unauthenticated requests.
- **Coverage areas**:
  - Permissions CRUD (create/list/update/delete patterns)
  - Backup CRUD (create/list/restore/delete)
  - JSON export endpoint
  - Scheduled jobs list, enable/disable, manual run
  - Environment endpoint returns integration status
  - Session endpoint includes user info

## Architecture Notes

See `architecture.md` for full details. Key decisions:

- **RoleAssignmentPattern** uses a `matchType` field (`exact` or `regex`)
  to distinguish between literal email matches and regex patterns.
- **SchedulerService** uses a middleware-driven or interval-based tick
  that checks for due jobs and locks them with `FOR UPDATE SKIP LOCKED`
  to prevent double-execution in multi-process scenarios.
- **BackupService** stores backups in a configurable local directory
  (default: `data/backups/`). Each backup includes metadata (timestamp,
  size, type).
- Both new services register into the existing `ServiceRegistry` from
  Sprint 004.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

1. **001** — Add RoleAssignmentPattern model and permissions service
2. **002** — Build permissions admin panel
3. **003** — Add ScheduledJob model and scheduler service
4. **004** — Build scheduled jobs admin panel
5. **005** — Create backup service and import/export panel
6. **006** — Enhance environment and session panels
7. **007** — Write admin dashboard tests
