---
sprint: "010"
status: draft
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 010: Admin Console Consolidation, Anthropic Admin API, Env Var Cleanup

Sprint use case IDs follow the pattern `SUC-010-NNN`. Each maps to one or
more tickets and traces to the project-level use cases in
`docs/clasi/design/usecases.md` where applicable.

---

## SUC-010-001: Admin Lands on Dashboard After Login

**Actor:** Administrator

**Related UC:** UC-003 (post-login routing)

**Preconditions:**
- Administrator completes Google or GitHub OAuth.

**Main Flow:**
1. OAuth callback resolves the user with `role=admin`.
2. Server redirects to `/` instead of `/admin/provisioning-requests`.
3. Dashboard page fetches `GET /api/admin/stats` and `GET /api/admin/provisioning-requests?status=pending`.
4. Admin sees: pending-requests widget (up to 5 rows with inline Approve/Deny buttons), cohort list, and three role-count cards (Students, Staff, Admins).

**Postconditions:**
- Admin is on the Dashboard. No admin action has been taken.

**Error Flows:**
- Stats fetch fails: Dashboard renders with inline error in the affected widget; other widgets still load.

---

## SUC-010-002: Admin Approves or Denies Provisioning Request from Dashboard

**Actor:** Administrator

**Related UC:** UC-005, UC-006

**Preconditions:**
- At least one ProvisioningRequest exists with `status=pending`.
- Admin is on the Dashboard.

**Main Flow:**
1. Dashboard widget shows up to 5 pending requests. If more than 5 exist, a "See all N" button links to `/requests`.
2. Admin clicks [Approve] on a row. App posts to `POST /api/admin/provisioning-requests/:id/approve`.
3. Row disappears from the widget. Widget re-fetches the pending list.

*Deny sub-flow:*
1. Admin clicks [Deny]. App posts to `POST /api/admin/provisioning-requests/:id/reject`.
2. Row disappears.

**Postconditions:**
- ProvisioningRequest status updated. AuditEvent recorded.

**Error Flows:**
- API returns an error: inline error message displayed on that row; widget remains functional for other rows.

---

## SUC-010-003: Admin Approves Claude Request — Auto-Chain Creates Workspace First

**Actor:** Administrator

**Related UC:** UC-005, UC-006

**Preconditions:**
- ProvisioningRequest exists with `requestType=claude`, `status=pending`.
- Target student has no active `type=workspace` ExternalAccount.
- Student has a cohort with a valid OU path.

**Main Flow:**
1. Admin approves the Claude request (from Dashboard widget or Provisioning Requests page).
2. `ProvisioningRequestService.approve()` detects: `requestType === 'claude'` and no active workspace ExternalAccount.
3. Service auto-promotes to `workspace_and_claude` semantics:
   a. Calls `WorkspaceProvisioningService.provision(student, actor)` — creates Google Workspace account, emits welcome email, creates workspace ExternalAccount.
   b. Calls `ClaudeProvisioningService.provision(student, actor)` — sends Anthropic org invite to student's new League email, creates claude ExternalAccount with `status=pending`.
4. Single `request_approved` AuditEvent is recorded with `details.auto_chained = true`.

**Postconditions:**
- Student has an active workspace ExternalAccount and a pending claude ExternalAccount.
- ProvisioningRequest status is `approved`.
- Student receives Google Workspace welcome email; Claude invite is sent to their League address.

**Error Flows:**
- Workspace provisioning fails: entire operation aborted; request remains pending; error surfaced to admin.
- Claude invite fails after workspace succeeds: workspace ExternalAccount committed; Claude ExternalAccount not created; admin sees partial error.

---

## SUC-010-004: Admin Provisions League Workspace Account from User Detail Page

**Actor:** Administrator

**Related UC:** UC-005

**Preconditions:**
- Admin is on the User Detail page for a student.
- Student has `role=student`, is assigned to a cohort with an OU path, and has no active `type=workspace` ExternalAccount.

**Main Flow:**
1. Admin sees a "Create League Account" button in the Workspace section.
2. Admin clicks the button. App posts to `POST /api/admin/users/:id/provision-workspace`.
3. Server calls `WorkspaceProvisioningService.provision(student, actor)`.
4. Response returns the new ExternalAccount. User Detail page re-fetches and shows the active workspace row.

**Postconditions:**
- Student has an active workspace ExternalAccount. Pike13 write-back triggered (if Pike13 linked).

**Error Flows:**
- Student has no cohort: 422 returned; button shows error message.
- Student already has an active workspace account: 422; button is not rendered (UI pre-check).
- User is not `role=student`: 422; button is not rendered (UI role-gate).

---

## SUC-010-005: Admin Views Role-Count Stats

**Actor:** Administrator

**Preconditions:**
- Admin is authenticated.

**Main Flow:**
1. Dashboard loads and calls `GET /api/admin/stats`.
2. Server performs a single Prisma aggregation and returns:
   `{ totalStudents, totalStaff, totalAdmins, pendingRequests, openMergeSuggestions, cohortCount }`.
3. Dashboard renders three role-count cards (Students, Staff, Admins).

**Postconditions:**
- No state changed; read-only.

---

## SUC-010-006: Admin Triggers Anthropic Claude Sync

**Actor:** Administrator

**Preconditions:**
- Admin is on the Sync page.
- `ANTHROPIC_ADMIN_API_KEY` is configured.

**Main Flow:**
1. Admin clicks "Sync Claude accounts" in the Anthropic section of the Sync page.
2. App posts to `POST /api/admin/sync/claude`.
3. `AnthropicSyncService.reconcile()` runs:
   a. Fetches org users from `GET /v1/organizations/users` (paginated).
   b. Fetches pending invites from `GET /v1/organizations/invites` (paginated).
   c. For each org user not yet linked: matches by email; creates `ExternalAccount(type='claude', status='active')`.
   d. For each invite whose email now appears in org users: transitions pending ExternalAccount to active, rewrites `external_id` to org user id, calls `addUserToWorkspace(studentsWorkspaceId, userId)`.
   e. For each local claude ExternalAccount whose external_id is absent from both lists: transitions to `removed`, emits `claude_sync_flagged` AuditEvent.
4. Returns `SyncReport { created, linked, invitedAccepted, removed, unmatched: string[] }`.
5. SyncPanel renders the report inline.

**Postconditions:**
- Local ExternalAccount rows are reconciled against Anthropic org state.
- AuditEvents emitted for status transitions.

**Error Flows:**
- Anthropic API unreachable: 503 returned; SyncPanel shows error banner.
- Individual user match failure: user email added to `unmatched`; sync continues for remaining users.

---

## SUC-010-007: Admin Views Anthropic Org Probe Status

**Actor:** Administrator

**Preconditions:**
- Admin is on the Sync page.
- `ANTHROPIC_ADMIN_API_KEY` is configured.

**Main Flow:**
1. Admin views the Anthropic section of the Sync page; probe data auto-loads via `GET /api/admin/anthropic/probe`.
2. Response: `{ ok, org: { id, name }, userCount, workspaces[], invitesCount, writeEnabled }`.
3. Probe card displays org name, user count, workspace list, and write-enabled status.

**Postconditions:**
- No state changed; read-only.

**Error Flows:**
- API key missing or invalid: probe returns `{ ok: false, error: '...' }`; card shows credential error without breaking the rest of the Sync page.

---

## SUC-010-008: Developer Runs Anthropic Probe Script

**Actor:** Developer / Operator

**Preconditions:**
- `ANTHROPIC_ADMIN_API_KEY` is set in the shell environment.
- Node.js is available.

**Main Flow:**
1. Operator runs `node scripts/probe-anthropic-admin.mjs`.
2. Script hits four endpoints: `/v1/organizations/me`, `/v1/organizations/users?limit=1`, `/v1/organizations/workspaces?limit=10`, `/v1/organizations/invites?limit=1`.
3. Prints a single OK/FAIL summary with org name, user count, and workspace list.

**Postconditions:**
- No state changed. Exit code 0 on success, non-zero on failure.
