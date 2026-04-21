---
status: pending
---

# Plan — Admin UX overhaul: dashboard, route split, user-detail account lifecycle

## Context

The admin experience is currently split awkwardly. Everything an admin does day-to-day — approving provisioning requests, managing cohorts, syncing from Google and Pike13, reviewing merge suggestions, browsing users — lives under `/admin/*`, sharing a layout with ops-only things (Environment, Database, Logs, Sessions, Scheduled Jobs). There's no overview; admins land on whichever page they clicked last. The user detail page can't create or tear down accounts on demand; it can only act on rows that already exist in `ExternalAccount`.

The stakeholder wants:

1. **Route split.** Normal admin work — Dashboard, Provisioning Requests, Cohorts, Users, Sync, Merge Queue — moves into the main AppLayout, gated by the `admin` role. `/admin/*` remains for ops exotica (Environment / Database / Logs / Sessions / Scheduled Jobs / Configuration / Import-Export).
2. **Admin Dashboard** as the landing page for admins, showing pending-request summary (+ inline approve/deny for the first 5), cohort list, and user counts by role.
3. **Request approve/deny inline** on both the dashboard widget and the full list.
4. **Claude-only request handling** — if the target user has no active League workspace account, approval auto-chains: create workspace, then Claude seat. Single click for the admin.
5. **User detail page actions** — on a student row, admins can create / suspend / delete the League workspace account and create / disable the Claude account directly (not just act on pre-existing `ExternalAccount` rows). Uses the newly-provisioned `ANTHROPIC_ADMIN_API_KEY` for org-scoped Claude lifecycle. Staff and admin user rows keep their accounts read-only.

User decisions captured:
- Route split: admin pages in main nav; ops-only under /admin.
- Claude-without-League: auto-chain.
- Dashboard stats: user counts by role (total students / staff / admins).
- Workspace lifecycle on user detail: students only.

## Deliverable

A CLASI TODO artifact describing the scope. **Not implementation.** `/todo` skill persists it into `docs/clasi/todo/` for future sprint planning.

## Scope (for the TODO body)

### Navigation + routing

- **AppLayout** ([client/src/components/AppLayout.tsx](client/src/components/AppLayout.tsx)) adds an "Admin section" of the main nav, shown only when `user.role === 'admin'`:
  - Dashboard (`/`)
  - Provisioning Requests (`/requests`)
  - Cohorts (`/cohorts`)
  - Users (`/users`)
  - Sync (`/sync`)
  - Merge Queue (`/merge-queue`)
- New routes added under the main `<AppLayout>` group in [client/src/App.tsx](client/src/App.tsx). Each has a lightweight `<AdminOnlyRoute>` guard (redirects non-admins to `/account`).
- `/admin/*` keeps only: Environment, Database, Logs, Sessions, Scheduled Jobs, Configuration, Import/Export. Remove the ones we moved out from ADMIN_NAV.
- Role-based post-login redirect ([server/src/routes/auth.ts](server/src/routes/auth.ts)) updates `admin → /` (dashboard) instead of `/admin/provisioning-requests`.

### Admin Dashboard (`client/src/pages/admin/Dashboard.tsx`)

Three widgets, vertically stacked:

1. **Pending Requests** — fetches `GET /api/admin/provisioning-requests?status=pending`. Renders up to 5 inline rows with user name, email, request type (workspace / claude / workspace_and_claude), submitted-at, and [Approve] [Deny] buttons. Approve/Deny post to existing `/api/admin/provisioning-requests/:id/{approve,reject}` endpoints. If total > 5, "See all N" button routes to `/requests`.
2. **Cohorts** — compact list of active cohorts (name + student count). Header links to `/cohorts`.
3. **User counts by role** — three cards: Students / Staff / Admins (totals from `GET /api/admin/stats` — new endpoint returning `{ students, staff, admins }`).

### Provisioning Requests — auto-chain Claude

Update [server/src/services/provisioning-request.service.ts](server/src/services/provisioning-request.service.ts) `approve()`:

- If `requestType === 'claude'` AND the user has no active workspace `ExternalAccount`, internally promote the request to `workspace_and_claude` semantics: run `WorkspaceProvisioningService.provision` first, then `ClaudeProvisioningService.provision`, both inside the existing transaction.
- Emit a single `request_approved` audit event annotating `auto_chained: true` so the audit trail shows what happened.
- If the user is not a student, surface the existing `UnprocessableError` unchanged.

### User detail page — new lifecycle actions (students only)

Extend [client/src/pages/admin/UserDetailPanel.tsx](client/src/pages/admin/UserDetailPanel.tsx):

- **Workspace section** gains a "Create League Account" button when the row is `role=student` AND no active workspace ExternalAccount exists AND a cohort is assigned. Posts to a new `POST /api/admin/users/:id/provision-workspace` (mirror of the existing `provision-claude` route; calls `WorkspaceProvisioningService.provision`).
- **Claude section** gains a "Create Claude Seat" button (this already exists from T011 of sprint 005 via `POST /api/admin/users/:id/provision-claude`).
- Existing Suspend / Remove buttons on Workspace and Claude external accounts continue to work — no code change there. Button labels stay `Delete League Account`, `Disable Claude`, `Delete Claude` per T008 of sprint 009.
- For `role=staff` and `role=admin` user rows, the lifecycle buttons are omitted entirely. The ExternalAccount list remains read-only on those rows.

### Anthropic Admin API integration

The existing `ClaudeTeamAdminClient` ([server/src/services/claude-team/claude-team-admin.client.ts](server/src/services/claude-team/claude-team-admin.client.ts)) uses `CLAUDE_TEAM_API_KEY`. The stakeholder added a broader `ANTHROPIC_ADMIN_API_KEY` for organization-level user management. Plan:

- Extend `ClaudeTeamAdminClient` to prefer `ANTHROPIC_ADMIN_API_KEY` when set, falling back to `CLAUDE_TEAM_API_KEY` for backward compat.
- If Anthropic's Admin API exposes endpoints for creating org members (vs. Team-seat invites), expose them in the client for use by the new provisioning path. Confirm endpoint shape from https://docs.claude.com/en/api/admin-api before coding.
- Document the precedence in `config/dev/secrets.env.example`.

### New endpoints

- `GET /api/admin/stats` — returns `{ totalStudents, totalStaff, totalAdmins, pendingRequests, openMergeSuggestions, cohortCount }`. A single Prisma aggregation call.
- `POST /api/admin/users/:id/provision-workspace` — wraps `WorkspaceProvisioningService.provision`. 422 if not a student, if no cohort, or if already has an active workspace account.

### Out of scope

- Sophisticated user analysis views (stakeholder explicitly deferred: "let's not worry about it").
- Non-student workspace lifecycle. The Users panel and user-detail buttons hide those actions on staff/admin rows; no new constraints needed server-side because the existing routes already refuse on non-students via service-layer checks.
- Bulk request approval (request list is one-at-a-time inline; bulk can come later).
- Renaming routes that already exist under `/admin/*` for consistency — we move content, not URLs, except for the new top-level admin pages.

## Files the eventual implementation will touch

**New:**
- `client/src/pages/admin/Dashboard.tsx` + its widgets.
- `client/src/components/AdminOnlyRoute.tsx` (simple role guard).
- `server/src/routes/admin/stats.ts` with `GET /admin/stats`.
- Route entry `POST /admin/users/:id/provision-workspace` in [server/src/routes/admin/users.ts](server/src/routes/admin/users.ts).

**Modified:**
- [client/src/App.tsx](client/src/App.tsx) — new routes under AppLayout.
- [client/src/components/AppLayout.tsx](client/src/components/AppLayout.tsx) — conditional admin nav section, remove relocated entries from ADMIN_NAV.
- [client/src/pages/admin/UserDetailPanel.tsx](client/src/pages/admin/UserDetailPanel.tsx) — Create-Workspace button, role-gated lifecycle.
- [server/src/services/provisioning-request.service.ts](server/src/services/provisioning-request.service.ts) — auto-chain logic.
- [server/src/services/claude-team/claude-team-admin.client.ts](server/src/services/claude-team/claude-team-admin.client.ts) — `ANTHROPIC_ADMIN_API_KEY` preference.
- [server/src/routes/auth.ts](server/src/routes/auth.ts) — admin post-login redirect to `/`.
- `config/dev/secrets.env.example` — document `ANTHROPIC_ADMIN_API_KEY`.

## Verification

- Manual: log in as admin → lands on Dashboard → see pending requests / cohort list / user counts. Approve one inline. Click "See all" when > 5. Navigate Cohorts / Users / Sync / Merge Queue via main nav. Open a student in Users → Create League Account → confirm workspace ExternalAccount appears and student gets email. Same flow but Create Claude Seat. Try Create Claude for a student without a workspace account → observe auto-chain.
- Tests: route-level tests for `/admin/stats` and `POST /admin/users/:id/provision-workspace`; update `ProvisioningRequestService.approve` test suite with an auto-chain scenario; client component tests for Dashboard widgets.

## Next action

Run the `/todo` skill with title "Admin UX overhaul: dashboard, route split, on-demand account lifecycle" and use the scope sections above as the body.
