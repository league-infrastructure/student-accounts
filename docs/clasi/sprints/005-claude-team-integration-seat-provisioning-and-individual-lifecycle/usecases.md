---
sprint: "005"
status: active
---

# Sprint 005 Use Cases

Use case IDs match the master list in `docs/clasi/design/usecases.md`. Each
entry below excerpts the relevant preconditions and main flow, then adds
sprint-specific acceptance criteria for implementation.

---

## SUC-001: Claude Team Seat Provisioning (UC-006)

**Source:** UC-006 — Admin Provisions Claude Team Seat

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Target User exists with role=student.
- Target User has an active League Workspace ExternalAccount (type=workspace,
  status=active). This is a hard gate enforced by the server.
- No active or pending Claude Team ExternalAccount (type=claude) exists for
  this User.

**Main Flow:**
1. Administrator opens the target User's admin detail view.
2. "Provision Claude Team Seat" button is present and enabled only when the
   preconditions are met; otherwise it is disabled with an explanatory tooltip.
3. Administrator clicks the button.
4. Server validates preconditions (workspace account active, no existing claude account).
5. Server calls `ClaudeTeamAdminClient.inviteMember` using the User's League
   Workspace email address only (never the external primary email).
6. Server creates an ExternalAccount record: type=claude, status=active,
   external_id set to the member identifier returned by the API.
7. Server records AuditEvent: action=provision_claude, actor=admin, target_user.
8. UI refreshes the External Accounts section to show the new Claude account.

**Postconditions:**
- User has an active Claude Team ExternalAccount.
- Invitation sent to the User's League Workspace inbox only.

**Acceptance Criteria:**
- [ ] Precondition check blocks provisioning when no active workspace account exists; returns 422.
- [ ] Precondition check blocks provisioning when a claude account already exists; returns 409.
- [ ] ClaudeTeamAdminClient.inviteMember is called with the workspace email, not the primary email.
- [ ] ExternalAccount row created with type=claude, status=active.
- [ ] AuditEvent recorded with action=provision_claude.
- [ ] POST /admin/users/:id/provision-claude returns 201 on success.
- [ ] ProvisioningRequest approval path for type=claude calls the same provisioning service.

---

## SUC-002: Admin Add Login on User's Behalf (UC-008)

**Source:** UC-008 — Admin Adds Login on User's Behalf

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Target User exists.
- The provider identity to be added is not already attached to any User.

**Main Flow:**
1. Administrator opens the target User's admin detail view, Logins section.
2. Administrator clicks "Add Login," selects provider (Google or GitHub), and
   supplies the provider_user_id and optional provider_email.
3. Server validates provider_user_id is not already in use (409 if it is).
4. Server creates the Login record via LoginService.create.
5. If provider=github: server calls the Pike13 write-back call site
   (pike13WritebackStub.githubHandle) — a no-op stub this sprint; Sprint 006
   implements actual write-back.
6. AuditEvent recorded: action=add_login, actor=admin, target_user, provider.

**Postconditions:**
- Target User has one additional Login.
- Pike13 GitHub Username field updated (stub call site placed; no-op this sprint).

**Acceptance Criteria:**
- [ ] POST /admin/users/:id/logins creates the Login and records audit event.
- [ ] 409 returned when provider_user_id already exists on another user.
- [ ] GitHub login add calls the Pike13 write-back stub (confirmed by test that the stub was invoked).
- [ ] Response includes the created Login record.
- [ ] 403 returned for non-admin callers.

---

## SUC-003: Admin Remove Login on User's Behalf (UC-009)

**Source:** UC-009 — Admin Removes Login on User's Behalf

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Target User has at least two Logins.

**Main Flow:**
1. Administrator opens the target User's admin detail view, Logins section.
2. Administrator clicks "Remove" on the target Login.
3. Server verifies the user will have at least one login remaining.
4. Server deletes the Login record via LoginService.delete.
5. AuditEvent recorded: action=remove_login, actor=admin, target_user, provider.

**Postconditions:**
- Target User has one fewer Login; at least one remains.

**Acceptance Criteria:**
- [ ] DELETE /admin/users/:id/logins/:loginId deletes the login and records audit event.
- [ ] 422 returned when removal would leave the user with zero logins.
- [ ] 404 returned when the login does not exist.
- [ ] 403 returned for non-admin callers.

---

## SUC-004: Individual Suspend External Account (UC-015)

**Source:** UC-015 — Individual Suspend — External Account

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Target User has an active ExternalAccount of the type to be suspended.

**Main Flow:**
1. Administrator opens the User's detail view.
2. Administrator clicks "Suspend" on the target ExternalAccount row; a
   confirmation dialog appears.
3. Administrator confirms.
4. For type=workspace: server calls GoogleWorkspaceAdminClient.suspendUser.
5. For type=claude: server calls ClaudeTeamAdminClient.suspendMember.
6. Server updates ExternalAccount: status=suspended, status_changed_at=now.
7. AuditEvent recorded: action=suspend_workspace or action=suspend_claude.

**Postconditions:**
- ExternalAccount is in status=suspended. Data is preserved. Action is reversible.

**Acceptance Criteria:**
- [ ] POST /admin/external-accounts/:id/suspend suspends the account.
- [ ] Workspace suspend calls GoogleWorkspaceAdminClient.suspendUser.
- [ ] Claude suspend calls ClaudeTeamAdminClient.suspendMember.
- [ ] ExternalAccount.status = 'suspended' and status_changed_at set.
- [ ] Correct audit action string recorded (suspend_workspace vs suspend_claude).
- [ ] 422 returned if account is already suspended or removed.
- [ ] 403 returned for non-admin callers.

---

## SUC-005: Individual Remove External Account (UC-016)

**Source:** UC-016 — Individual Remove — External Account

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Target User has an active or suspended ExternalAccount.

**Main Flow:**
1. Administrator opens the User's detail view.
2. Administrator clicks "Remove" on the target ExternalAccount; confirmation
   dialog warns the action is not reversible.
3. Administrator confirms.
4. For type=workspace:
   a. If not already suspended, calls GoogleWorkspaceAdminClient.suspendUser.
   b. Sets ExternalAccount.scheduled_delete_at = now + 3 days.
   c. Updates ExternalAccount: status=removed, status_changed_at=now.
5. For type=claude:
   a. Calls ClaudeTeamAdminClient.removeMember.
   b. Updates ExternalAccount: status=removed, status_changed_at=now.
6. AuditEvent recorded: action=remove_workspace or action=remove_claude.

**Postconditions:**
- ExternalAccount is in status=removed.
- Google Workspace account: suspended immediately, deleted after 3 days.
- Claude Team seat: released from workspace.

**Acceptance Criteria:**
- [ ] POST /admin/external-accounts/:id/remove removes the account.
- [ ] Workspace removal: suspends (via API) if not already suspended.
- [ ] Workspace removal: ExternalAccount.scheduled_delete_at set to now + 3 days.
- [ ] Workspace removal: ExternalAccount.status = 'removed' immediately.
- [ ] Claude removal: calls ClaudeTeamAdminClient.removeMember.
- [ ] Claude removal: ExternalAccount.status = 'removed' immediately.
- [ ] Correct audit action string recorded.
- [ ] 403 returned for non-admin callers.

---

## SUC-006: Deprovision Student Leaving School (UC-017)

**Source:** UC-017 — Deprovision Student Leaving School

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Student User exists with any combination of active External Accounts.

**Main Flow:**
1. Administrator opens the departing student's User detail view.
2. Administrator clicks "Deprovision Student" button.
3. Confirmation dialog lists all active accounts that will be removed.
4. Administrator confirms.
5. For each active ExternalAccount:
   - workspace: executes the UC-016 workspace removal flow (suspend + schedule delete in 3 days).
   - claude: executes the UC-016 Claude removal flow (immediate seat release).
   - pike13: left untouched.
6. One AuditEvent recorded per removed account.

**Postconditions:**
- All workspace and claude ExternalAccounts set to status=removed.
- Workspace deletion scheduled for 3 days out.
- Pike13 and GitHub records unchanged.

**Acceptance Criteria:**
- [ ] POST /admin/users/:id/deprovision runs the composite removal.
- [ ] Each applicable ExternalAccount is removed per its type rules.
- [ ] Pike13 accounts are skipped entirely.
- [ ] Multiple AuditEvents emitted — one per removed account.
- [ ] 403 returned for non-admin callers.
- [ ] If one API call fails, the error is collected and reported; other removals proceed (fail-soft).

---

## SUC-007: Scheduled Workspace Deletion (system behavior supporting UC-016 and UC-017)

**Actor:** System (scheduled job)

**Behavior:**
A scheduler job runs on the template's existing scheduler infrastructure. It
queries ExternalAccount records with type=workspace, status=removed, and
scheduled_delete_at <= now(). For each, it calls
GoogleWorkspaceAdminClient.deleteUser. After a successful delete, it clears
scheduled_delete_at (or sets a deletion_completed_at timestamp) and records an
AuditEvent. Failures are logged at ERROR level; the job continues to the next
record.

**Acceptance Criteria:**
- [ ] scheduled_delete_at column exists on ExternalAccount (schema migration).
- [ ] Scheduler job registered on the existing SchedulerService infrastructure.
- [ ] Records with status=removed and scheduled_delete_at<=now are processed.
- [ ] GoogleWorkspaceAdminClient.deleteUser called for each eligible record.
- [ ] AuditEvent recorded with action=workspace_hard_delete after successful deletion.
- [ ] Failed deletes do not halt the job; they are logged at ERROR level.
