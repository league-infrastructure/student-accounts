---
status: final
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 011 Use Cases

Two sprint-level use cases, one per TODO. Both refine existing top-level
admin lifecycle use cases established in earlier sprints.

---

## SUC-011-001: Admin unsuspends a single external account
Parent: UC-008 (Individual account lifecycle management)

- **Actor**: Administrator
- **Preconditions**:
  - The admin is viewing `/users/:id` for a user who has at least one
    `ExternalAccount` whose `status = 'suspended'`.
  - The suspended account is either type `workspace` or type `claude`.
- **Main Flow**:
  1. Admin loads the user detail page.
  2. For every `ExternalAccount` in status `suspended`, the page renders
     the current status ("suspended") clearly in the corresponding account
     card, alongside the existing identifier fields.
  3. Each suspended `ExternalAccount` also renders an **Unsuspend** button.
  4. Admin clicks **Unsuspend** on a suspended workspace account.
  5. The client confirms the action, then posts to
     `POST /api/admin/external-accounts/:id/unsuspend`.
  6. The server flips the row to `status = 'active'`,
     `status_changed_at = now`, and calls
     `GoogleWorkspaceAdminClient.unsuspendUser(email)`.
  7. An `unsuspend_workspace` audit event is recorded.
  8. Admin clicks **Unsuspend** on a suspended claude account.
     - If the ExternalAccount's `external_id` is an invite (`invite_*`),
       the server issues a fresh `inviteToOrg` call with the student's
       League email, stores the new invite id as the row's `external_id`,
       flips `status` to `pending`, and records an
       `unsuspend_claude` audit event.
     - If the `external_id` is a user id (`user_*`), the server returns
       422 with a clear "not reversible; re-provision required" message
       and the UI shows that message as a non-fatal hint without
       flipping any state.
- **Postconditions**:
  - The suspended workspace account is reactivated in Google and locally
    marked `active`.
  - Suspended claude invites are re-issued; suspended claude user accounts
    are surfaced as unrecoverable with clear admin guidance.
  - Every state transition is audited.
- **Acceptance Criteria**:
  - [ ] A suspended workspace ExternalAccount's card shows the literal
        status "suspended" on `/users/:id`.
  - [ ] A suspended workspace ExternalAccount's card shows an Unsuspend
        button that is enabled only while the account is suspended.
  - [ ] A suspended claude ExternalAccount's card shows the literal
        status "suspended" and an Unsuspend button.
  - [ ] Clicking Unsuspend on a suspended workspace account calls
        `POST /api/admin/external-accounts/:id/unsuspend`, which in turn
        calls `googleClient.unsuspendUser` and flips the row to `active`.
  - [ ] Clicking Unsuspend on a suspended claude account with an
        `invite_*` external_id cancels-and-reinvites, persisting the new
        invite id and setting status to `pending`.
  - [ ] Clicking Unsuspend on a suspended claude account with a
        `user_*` external_id returns 422 and the UI surfaces the
        "not reversible; re-provision required" message.
  - [ ] Every unsuspend action records an audit event of action
        `unsuspend_workspace` or `unsuspend_claude`.

---

## SUC-011-002: Admin runs bulk suspend / delete across a cohort
Parent: UC-009 (Bulk cohort operations)

- **Actor**: Administrator
- **Preconditions**:
  - The admin is viewing `/cohorts/:id` for a cohort containing one or
    more active students.
  - Students may have any combination of `workspace` and `claude`
    ExternalAccounts, in any state.
- **Main Flow**:
  1. The cohort page renders a simplified bulk-action row:
     **Create Claude seats**, **Suspend All**, **Delete All**.
  2. The previous per-type buttons (Create League, Create Log, Suspend
     League, Suspend Claude, Delete League, Delete Claude) are no longer
     rendered.
  3. Admin clicks **Suspend All**.
  4. The client confirms, then posts to
     `POST /api/admin/cohorts/:id/bulk-suspend-all`.
  5. The server iterates every live (`active`) workspace and claude
     ExternalAccount for every active student in the cohort and calls
     `ExternalAccountLifecycleService.suspend` on each in its own
     transaction.
  6. The response returns
     `{ succeeded: number[], failed: [{ accountId, userId, userName, type, error }] }`.
  7. The banner on the cohort page reports `N succeeded, M failed` and
     lists each failure with its user name and reason (matching the
     existing per-type flow's format).
  8. Admin clicks **Delete All** — same flow against
     `POST /api/admin/cohorts/:id/bulk-remove-all`, iterating every
     eligible (`active` or `suspended`) workspace and claude account.
  9. Admin clicks **Create Claude seats** — unchanged behavior.
- **Postconditions**:
  - Bulk Suspend All has suspended all live workspace + claude
    ExternalAccounts for every active student in the cohort,
    fail-soft.
  - Bulk Delete All has removed all active/suspended workspace + claude
    ExternalAccounts for every active student in the cohort, fail-soft.
  - Each per-account operation emits its individual lifecycle audit
    event.
- **Acceptance Criteria**:
  - [ ] `/cohorts/:id` no longer renders Create League, Create Log,
        Suspend League, Suspend Claude, Delete League, or Delete Claude
        buttons.
  - [ ] `/cohorts/:id` renders exactly three bulk-action buttons:
        Create Claude seats, Suspend All, Delete All.
  - [ ] `POST /api/admin/cohorts/:id/bulk-suspend-all` suspends every
        active workspace + claude ExternalAccount for every active
        student in the cohort, fail-soft.
  - [ ] `POST /api/admin/cohorts/:id/bulk-remove-all` removes every
        active/suspended workspace + claude ExternalAccount for every
        active student in the cohort, fail-soft.
  - [ ] The response shape for both new endpoints is the same
        `{ succeeded: number[], failed: [...] }` contract as the
        per-type bulk endpoints; each failure includes user name and
        error reason.
  - [ ] HTTP status is 200 when all succeed (or zero eligible), 207
        when there's a partial failure.
  - [ ] The cohort page banner reports the same succeeded/failed
        summary format already used for existing bulk ops.
