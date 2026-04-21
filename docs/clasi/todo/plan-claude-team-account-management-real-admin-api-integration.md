---
status: pending
---

# Plan — Claude Team account management: real Admin API integration

## Context

Sprint 005 built a `ClaudeTeamAdminClient` against *guessed* Anthropic endpoints (`/organizations/{product_id}/members`) using a made-up env var (`CLAUDE_TEAM_API_KEY` + `CLAUDE_TEAM_PRODUCT_ID`). Those endpoints don't exist. The stakeholder has now provisioned a real `ANTHROPIC_ADMIN_API_KEY` with org-admin scope, and a probe (`GET /v1/organizations/me`) confirms we can reach **"The League of Amazing Programmers"** org (id `c256784d-…`), currently containing **1 user** (Eric Busboom) and **1 workspace** named **"Students"** (id `wrkspc_01FjPgDpkwvbQ7oWcf2VaQS9`).

This plan replaces the speculative client with a real one and adds the missing sync + admin UI pieces so account creation, listing, deletion and reconciliation all actually work.

Stakeholder decisions captured:
- Invite state model: separate `pending` (invite sent, not accepted) from `active` (observed in users list). Sync reconciles.
- Auto-add invited users to the `Students` workspace (env var `CLAUDE_STUDENT_WORKSPACE`, default `"Students"`).
- Delete semantics: Suspend = workspace-revoke (reversible). Delete = org-level hard delete.
- Initial sync: match by email, auto-create missing `ExternalAccount` rows; no manual review step.

## Deliverable

A CLASI TODO artifact describing the scope. **Not implementation.**

## Spec (for the TODO body)

### 0. Pre-flight probe script

Ship `scripts/probe-anthropic-admin.mjs` that, given `ANTHROPIC_ADMIN_API_KEY`, hits:
- `GET /v1/organizations/me`
- `GET /v1/organizations/users?limit=1`
- `GET /v1/organizations/workspaces?limit=10`
- `GET /v1/organizations/invites?limit=1`

…and reports a single OK/FAIL summary. Useful both for operators and for the CI smoke job.

### 1. Rewrite `ClaudeTeamAdminClient` → `AnthropicAdminClient`

Rename the module to reflect what it actually is. Keep the old export for one release as an alias to avoid a thousand-line test churn.

New interface:

```ts
interface AnthropicAdminClient {
  // Org-level
  listOrgUsers(cursor?: string): Promise<{ users: AnthropicUser[]; nextCursor: string|null }>;
  getOrgUser(userId: string): Promise<AnthropicUser>;
  inviteToOrg(params: { email: string; role?: 'user'|'developer'|'billing'|'admin' }): Promise<AnthropicInvite>;
  listInvites(cursor?: string): Promise<{ invites: AnthropicInvite[]; nextCursor: string|null }>;
  cancelInvite(inviteId: string): Promise<void>;
  deleteOrgUser(userId: string): Promise<void>;

  // Workspace-level
  listWorkspaces(): Promise<AnthropicWorkspace[]>;
  addUserToWorkspace(workspaceId: string, userId: string, role?: string): Promise<void>;
  removeUserFromWorkspace(workspaceId: string, userId: string): Promise<void>;
}
```

Auth: `x-api-key: <ANTHROPIC_ADMIN_API_KEY>` + `anthropic-version: 2023-06-01`. No `product_id` anywhere. Fall back to legacy `CLAUDE_TEAM_API_KEY` only if `ANTHROPIC_ADMIN_API_KEY` is unset (so local dev keeps working without doubling up).

`CLAUDE_TEAM_WRITE_ENABLED` stays as the kill switch for mutating calls.

Write a `FakeAnthropicAdminClient` with the same shape; re-export under both old and new names so the 8 existing test files keep compiling.

### 2. `ClaudeProvisioningService.provision` — real invite + workspace flow

Replace the current `inviteMember` call with:

1. Resolve the student's League workspace email (existing gate — must exist first).
2. `POST /v1/organizations/invites` with that email.
3. Resolve the "Students" workspace id once per process (cached), env override `CLAUDE_STUDENT_WORKSPACE`.
4. When the invite is accepted (next reconciliation tick), sync adds the accepted user to the Students workspace.
5. Write `ExternalAccount(type='claude', status='pending', external_id=<invite id>)` immediately on successful invite. External_id gets rewritten to the Anthropic user id once the invite is accepted.

### 3. New `AnthropicSyncService`

Admin-triggered (and scheduled hourly via `SchedulerService`) reconcile:

- Fetch `listOrgUsers()` — canonical source of active members.
- Fetch `listInvites()` — pending invites.
- For each **org user** not linked via ExternalAccount:
  - Match on `user.email == User.primary_email` (case-insensitive).
  - If match: create `ExternalAccount(type='claude', status='active', external_id=<anthropic user id>)`. This is the auto-link-by-email path for existing accounts.
  - If no match: flag in the report (no local user). Admin can review in the sync-report UI.
- For each **invite**:
  - Find the ExternalAccount row with `external_id=<invite id>` and status=`pending`.
  - Invite still pending in API → leave row alone.
  - Invite no longer in API AND its email is now in org users → transition row to `active`, rewrite `external_id=<org user id>`, and call `addUserToWorkspace(studentsWorkspaceId, userId)`.
  - Invite expired/cancelled → transition row to `removed`.
- For each **local claude ExternalAccount** whose `external_id` is not observed in either list → transition to `removed` (soft) and emit `claude_sync_flagged` audit event.
- Returns a `SyncReport { created, linked, invitedAccepted, removed, unmatched: string[] }`.

### 4. `ExternalAccountLifecycleService` — Claude suspend/remove

- **Suspend (Claude)** currently a no-op per OQ-003. Replace with `removeUserFromWorkspace(studentsWorkspaceId, externalId)`. Status → `suspended`. Reversible by a future "reactivate" action (out of scope here).
- **Remove (Claude)** → `deleteOrgUser(externalId)`. Status → `removed`.
- Both emit the existing audit events.

### 5. Admin API routes

New routes under `server/src/routes/admin/anthropic-sync.ts`:

- `POST /api/admin/sync/claude` → runs `AnthropicSyncService.reconcile()`, returns report. Mirrors the Pike13 sync route.
- `GET /api/admin/anthropic/probe` → calls the probe helper, returns `{ ok, org: {id,name}, userCount, workspaces[], invitesCount, writeEnabled }`. Useful for the admin UI "status" card.

Register in [server/src/routes/admin/index.ts](server/src/routes/admin/index.ts).

### 6. Admin UI

- Extend the existing `SyncPanel` page ([client/src/pages/admin/SyncPanel.tsx](client/src/pages/admin/SyncPanel.tsx)) with a third section "Anthropic (Claude)": a probe status card showing org name + user count + workspace list + credential mode, plus a "Sync Claude accounts" button that posts to `/api/admin/sync/claude` and renders the `SyncReport`.
- No changes to the user-detail page — the existing Create Claude Seat / Disable Claude / Delete Claude buttons now call through the rewritten lifecycle service and "just work."

### 7. Schema

No schema changes required. `ExternalAccount` already has:
- `type: 'claude'`
- `status: pending | active | suspended | removed`
- `external_id: String?` (doubles as invite id pre-acceptance, user id post)
- `status_changed_at`, `scheduled_delete_at` (not used for Claude).

## Files the eventual implementation will touch

**New:**
- `scripts/probe-anthropic-admin.mjs`
- `server/src/services/anthropic/anthropic-admin.client.ts` (replaces claude-team/claude-team-admin.client.ts — keep a re-export shim for the old path for one release).
- `server/src/services/anthropic/anthropic-sync.service.ts`
- `tests/server/helpers/fake-anthropic-admin.client.ts`
- `server/src/routes/admin/anthropic-sync.ts`

**Modified:**
- [server/src/services/claude-provisioning.service.ts](server/src/services/claude-provisioning.service.ts) — invite + workspace-add flow.
- [server/src/services/external-account-lifecycle.service.ts](server/src/services/external-account-lifecycle.service.ts) — real suspend via workspace-revoke, real remove via org-delete.
- [server/src/services/service.registry.ts](server/src/services/service.registry.ts) — wire `AnthropicAdminClient` with env var precedence (`ANTHROPIC_ADMIN_API_KEY` > legacy `CLAUDE_TEAM_API_KEY`).
- [server/src/routes/admin/index.ts](server/src/routes/admin/index.ts) — mount new sync routes.
- [client/src/pages/admin/SyncPanel.tsx](client/src/pages/admin/SyncPanel.tsx) — Anthropic section + probe card.
- `config/dev/secrets.env.example` — document the new env vars.
- 8 test files currently wiring `FakeClaudeTeamAdminClient` — re-seed their expectations with the new invite-based semantics; the renamed class is re-exported under the old name so imports still work.

## Environment variables

- **`ANTHROPIC_ADMIN_API_KEY`** — primary admin API key (already set by stakeholder).
- **`CLAUDE_STUDENT_WORKSPACE`** — workspace name (default `Students`) that students get added to on invite acceptance.
- **`CLAUDE_TEAM_WRITE_ENABLED=1`** — unchanged kill switch for mutating ops.
- **`CLAUDE_TEAM_API_KEY`**, **`CLAUDE_TEAM_PRODUCT_ID`** — deprecated; keep as fallback for one release, then drop.

## Verification

- Probe script: `node scripts/probe-anthropic-admin.mjs` prints OK + org name + user count + workspace list.
- Unit tests for `AnthropicAdminClient` error mapping (401/403/404/429 → typed errors) against a mocked fetch.
- Scenario tests for sync: 3 existing Anthropic users + 1 matching local user → creates 1 link, flags 2 unmatched. Pending invite accepted → reconcile transitions to active + workspace add. Local claude ExternalAccount whose external_id is gone → reconcile marks removed.
- Manual: Admin → Sync → "Sync Claude accounts" → report shows 1 linked (eric.busboom) and 0 errors. Pick a student in Users → Create Claude Seat → invite appears in `GET /v1/organizations/invites`. Accept invite in the real product → re-run sync → ExternalAccount flips to active and user is in Students workspace.

## Out of scope

- Fine-grained role assignments (admin/billing/developer). Every provisioned student becomes a plain org `user`.
- Per-cohort workspaces. One workspace (`Students`) for everyone.
- Resending expired invites (future feature).
- Reactivating suspended Claude accounts via UI (implicit future when there's a button for it).

## Next action

Run the `/todo` skill with title "Claude Team account management — real Anthropic Admin API integration" and use the sections above as the body.
