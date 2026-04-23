---
id: '010'
title: "Admin Console Consolidation \u2014 UX Overhaul, Anthropic Admin API, Env Var\
  \ Cleanup"
status: done
branch: sprint/010-admin-console-consolidation-ux-overhaul-anthropic-admin-api-env-var-cleanup
use-cases:
- SUC-010-001
- SUC-010-002
- SUC-010-003
- SUC-010-004
- SUC-010-005
- SUC-010-006
- SUC-010-007
- SUC-010-008
todos:
- plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
- plan-claude-team-account-management-real-admin-api-integration.md
- plan-rename-google-credentials-env-var-to-google-cred-file.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 010: Admin Console Consolidation — UX Overhaul, Anthropic Admin API, Env Var Cleanup

## Goals

1. Restructure the admin navigation so day-to-day admin work (Dashboard, Provisioning Requests, Cohorts, Users, Sync, Merge Queue) appears in the main AppLayout, gated by `role=admin`. Ops-only pages remain under `/admin/*`.
2. Deliver an Admin Dashboard landing page with a pending-requests widget (inline approve/deny for first 5), cohort list, and user-count cards.
3. Auto-chain Claude-only provisioning requests: if the student has no active workspace account, automatically provision workspace first, then Claude.
4. Enable on-demand workspace provisioning from the User Detail page (students only).
5. Rewrite `ClaudeTeamAdminClient` → `AnthropicAdminClient` targeting real Anthropic Admin API endpoints (`/v1/organizations/...`) using `ANTHROPIC_ADMIN_API_KEY`.
6. Deliver `AnthropicSyncService` for reconciling org users and pending invites, extend `SyncPanel` with an Anthropic section.
7. Rename `GOOGLE_CREDENTIALS_FILE` / `GOOGLE_SERVICE_ACCOUNT_FILE` to the single canonical `GOOGLE_CRED_FILE` in all code, tests, and docs.
8. Change admin post-login redirect from `/admin/provisioning-requests` to `/` (Dashboard).

## Problem

- Admin navigation mixes day-to-day workflow pages with ops-only tools in a single sidebar. Admins have no overview landing page.
- The Claude Team admin client targets fake/speculative endpoints. A real `ANTHROPIC_ADMIN_API_KEY` is now available.
- The Google credentials env var was renamed in config but not in code, causing Workspace sign-in and sync failures.
- Claude-only provisioning requests require two separate admin actions when the student has no League account.

## Solution

Three parallel workstreams, merged into a single sprint:

**A. Admin UX Overhaul** — Add `AdminOnlyRoute` guard, new `Dashboard.tsx`, split nav into admin-workflow section (in main AppLayout) vs ops section (under `/admin/*`), new `GET /api/admin/stats` endpoint, new `POST /api/admin/users/:id/provision-workspace` endpoint, auto-chain logic in `ProvisioningRequestService`.

**B. Anthropic Admin API** — New `AnthropicAdminClient` interface + `AnthropicAdminClientImpl` targeting real endpoints, `FakeAnthropicAdminClient`, `AnthropicSyncService`, probe script, two new admin routes, Anthropic section in `SyncPanel`. Re-export shim under old name for test compatibility.

**C. GOOGLE_CRED_FILE rename** — Single-pass mechanical rename across server code, passport config, sanity script, all tests, and env example files.

## Success Criteria

- Admin logs in and lands on `/` (Dashboard) showing pending requests widget, cohort list, and role counts.
- Admin can approve/deny a provisioning request inline from the Dashboard.
- Approving a Claude-only request for a workspace-less student auto-provisions both accounts.
- Admin can click "Create League Account" on a student detail row and see the new workspace ExternalAccount appear.
- `node scripts/probe-anthropic-admin.mjs` reports OK + org name + user count + workspace list.
- Admin → Sync → "Sync Claude accounts" → report shows correct linked/unmatched counts.
- `npm run test:server` passes with `GOOGLE_CRED_FILE` (old names produce no test coverage).
- Dev server restart with `GOOGLE_CRED_FILE` set allows `@jointheleague.org` sign-in and workspace sync.

## Scope

### In Scope

- Admin Dashboard page (`client/src/pages/admin/Dashboard.tsx`) with three widgets.
- `AdminOnlyRoute` component for role-gated main-layout routes.
- AppLayout nav split: admin-workflow links in main nav; ops links remain in ADMIN_NAV.
- `GET /api/admin/stats` → `{ totalStudents, totalStaff, totalAdmins, pendingRequests, openMergeSuggestions, cohortCount }`.
- `POST /api/admin/users/:id/provision-workspace` — on-demand workspace provisioning.
- Auto-chain in `ProvisioningRequestService.approve()` for Claude requests with no workspace.
- Admin post-login redirect → `/`.
- `AnthropicAdminClient` interface + implementation targeting real `/v1/organizations/...` endpoints.
- `FakeAnthropicAdminClient` test double; re-export shim under old `ClaudeTeamAdminClient` name.
- `AnthropicSyncService.reconcile()` with full pending→active invite transition logic.
- `ExternalAccountLifecycleService` Claude suspend (workspace-revoke) and remove (org-delete) real implementations.
- `POST /api/admin/sync/claude` and `GET /api/admin/anthropic/probe` routes.
- `SyncPanel` Anthropic section with probe card and sync button.
- `scripts/probe-anthropic-admin.mjs`.
- `GOOGLE_CRED_FILE` rename in all server code, tests, sanity script, env examples, and agent rules.
- Architecture doc annotations for old env var names.

### Out of Scope

- Dashboard widget for pending merge suggestions (stats endpoint returns counts only; merge-queue widget deferred).
- Per-cohort Claude workspaces (all students share the `Students` workspace).
- Bulk provisioning or bulk approval.
- Resending expired Claude invites.
- Reactivating suspended Claude accounts via UI.
- Non-student workspace lifecycle buttons (staff/admin rows remain read-only).
- Sophisticated user analysis or analytics views.

## Test Strategy

- Unit tests for `AnthropicAdminClient` error mapping (401, 403, 404, 429) against mocked `fetch`.
- Scenario tests for `AnthropicSyncService`: existing org users link by email; pending invite acceptance transitions to active + workspace-add; local claude ExternalAccount with unknown external_id transitions to removed.
- Route-level tests for `GET /api/admin/stats` and `POST /api/admin/users/:id/provision-workspace`.
- `ProvisioningRequestService.approve()` test suite extended with an auto-chain scenario.
- `GOOGLE_CRED_FILE` rename: update all test files that set old env var names.
- Client component tests for `Dashboard.tsx` widgets (React Testing Library).

## Architecture Notes

- `AnthropicAdminClient` is a new module under `server/src/services/anthropic/`. Old `claude-team/` directory is kept with a re-export shim for one release.
- `ServiceRegistry` gains `anthropicAdmin: AnthropicAdminClient` and `anthropicSync: AnthropicSyncService`.
- Stats endpoint is a single Prisma aggregation; no new DB models required.
- No Prisma schema changes in this sprint.
- Dashboard and AdminOnlyRoute live in `client/src/pages/admin/` and `client/src/components/` respectively.
- `CLAUDE_STUDENT_WORKSPACE` (default `"Students"`) controls which workspace new invites are added to post-acceptance.
- `CLAUDE_TEAM_WRITE_ENABLED` kill switch applies to `AnthropicAdminClient` mutating calls unchanged.

## GitHub Issues

None linked at sprint creation.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | GOOGLE_CRED_FILE rename — server code, passport, sanity script | — | 1 |
| 002 | GOOGLE_CRED_FILE rename — tests, env examples, architecture doc annotations | 001 | 2 |
| 003 | AnthropicAdminClient — interface, real implementation, typed errors | — | 1 |
| 004 | FakeAnthropicAdminClient and ServiceRegistry wiring | 003 | 2 |
| 005 | probe-anthropic-admin.mjs script | 003 | 2 |
| 006 | AnthropicSyncService + ExternalAccountLifecycleService Claude real ops | 004 | 3 |
| 007 | Anthropic sync routes and SyncPanel Anthropic section | 006 | 4 |
| 008 | GET /api/admin/stats endpoint | — | 1 |
| 009 | POST /api/admin/users/:id/provision-workspace endpoint | — | 1 |
| 010 | ProvisioningRequestService auto-chain and admin post-login redirect | — | 1 |
| 011 | AdminOnlyRoute component and AppLayout nav split | — | 1 |
| 012 | Admin Dashboard page — three widgets | 008, 011 | 2 |
| 013 | App.tsx route table update — Dashboard route, new admin-workflow routes | 011, 012 | 3 |
| 014 | UserDetailPanel — Create League Account button and role gating | 009, 011 | 3 |

**Groups**: Tickets in the same group can execute in parallel. Groups execute sequentially (1 before 2, etc.).
