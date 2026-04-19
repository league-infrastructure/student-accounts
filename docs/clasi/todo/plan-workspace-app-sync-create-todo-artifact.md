---
status: pending
---

# Plan — Workspace → App Sync (create TODO artifact)

## Context

Sprint 004 shipped **write** operations to Google Workspace (create cohort OU, provision student account). There is no **read/sync** direction yet: users who already exist in Workspace (staff in the staff OU, students already sitting in `/Students/...` sub-OUs) cannot be pulled into this app, so the admin UI's Users/Cohorts pages are empty until every person is re-created from scratch in the app.

We want the inverse operation: read Google's OU tree, upsert Cohorts and Users from what's already there. Explicit admin-triggered, three independent actions plus a combined "sync all":

1. **Sync cohorts** — read sub-OUs under the student root and reconcile to Cohort rows.
2. **Sync staff** — read users in the staff OU and reconcile to User rows (role=staff).
3. **Sync students** — read users in the student root and each sub-OU; reconcile to User rows (role=student, `cohort_id` derived from OU).

Domain rules (confirmed from code):
- Staff OU: `GOOGLE_STAFF_OU_PATH` (currently commented out in `.env`).
- Student root OU: `GOOGLE_STUDENT_OU_ROOT` (default `/Students`).
- A student directly in the root → no cohort (`cohort_id=null`).
- A student in `/Students/<sub>` → cohort is the one whose `google_ou_path` matches exactly.

User decisions captured:
- Missing-user behaviour: **flag only** — mark the associated `ExternalAccount` status as removed/suspended and surface a review list. Never delete User rows.
- Create scope for new-in-Google users: **User rows only**. Cohort creation is a separate, explicit operation (the "sync cohorts" action). No auto-creation of `ExternalAccount` rows on user sync.

## Deliverable

This task is **not implementation** — it's a CLASI TODO artifact that will feed sprint planning. Execute the `/todo` skill to create a TODO file in `docs/clasi/todo/` with the specification below.

## Files the eventual implementation will touch (for the TODO body)

- [server/src/services/google-workspace/google-workspace-admin.client.ts](server/src/services/google-workspace/google-workspace-admin.client.ts) — extend with `listOUs(parentPath)` (wrap `directory.orgunits.list`). `listUsersInOU(ouPath)` already exists.
- [tests/server/helpers/fake-google-workspace-admin.client.ts](tests/server/helpers/fake-google-workspace-admin.client.ts) — add fake for `listOUs`.
- New `server/src/services/workspace-sync.service.ts` with methods `syncCohorts`, `syncStaff`, `syncStudents`, `syncAll`. Uses existing `UserService.findByEmail`, `UserService.createWithAudit` (add `created_via='workspace_sync'` enum value), `UserService.updateRole`, `UserService.updateCohort`, and `CohortService` (add a non-OU-creating upsert method or reuse create + skip `createOU` when syncing).
- [server/prisma/schema.prisma](server/prisma/schema.prisma) — extend `UserCreatedVia` enum to include `workspace_sync`.
- New admin route `server/src/routes/admin/workspace-sync.ts` with POST `/admin/sync/cohorts`, `/admin/sync/staff`, `/admin/sync/students`, `/admin/sync/all`. Pattern mirrors [server/src/routes/admin/cohorts.ts](server/src/routes/admin/cohorts.ts).
- New admin page `client/src/pages/admin/WorkspaceSync.tsx` with four buttons + a result panel showing counts (created / updated / flagged) and the flagged-for-review list. Wire into [client/src/App.tsx](client/src/App.tsx) and [client/src/components/AppLayout.tsx](client/src/components/AppLayout.tsx) `ADMIN_NAV`.
- Audit events: `sync_started`, `sync_completed`, plus per-row `create_user`/`assign_cohort` via existing services.

## Sync semantics (for the TODO body)

- **syncCohorts**: call `listOUs(studentRoot)`. For each child OU, upsert a Cohort by `google_ou_path`; name defaults to the OU name. Do not call `createOU`.
- **syncStaff**: call `listUsersInOU(staffOuPath)`. For each Workspace user, upsert a User keyed on `primary_email`; set `role=staff`, `created_via=workspace_sync` for new rows. Preserve existing `admin` role (never downgrade).
- **syncStudents**: call `listUsersInOU(studentRoot)` + `listUsersInOU(each cohort OU)`. For each user, upsert; set `role=student` unless user is already `admin`; set `cohort_id` based on OU (null for root). If a student's OU does not match any Cohort row, leave `cohort_id=null` and add to the flagged list.
- **Flag-only removal**: for each existing `ExternalAccount` of type=workspace whose user's email was not seen in the just-read OU listing, set `status='removed'`. Emit a `workspace_sync_flagged` audit event. Never delete Users.
- All sync operations are idempotent and read-only from Google's perspective (no write-enable flag needed).

## Verification

Once implemented:
- Unit tests per service method using `FakeGoogleWorkspaceAdminClient` with seeded OUs/users.
- Manual end-to-end: set `GOOGLE_STAFF_OU_PATH` in `.env`, sign in as admin, click each sync button, verify Users/Cohorts pages reflect Workspace state.

## Next action

Run the `/todo` skill with the title "Sync from Google Workspace: OUs → Cohorts, users → staff/students" and paste the sync-semantics + files sections above as the body.
