---
sprint: "008"
status: final
---

# Sprint Use Cases — Sprint 008: Bulk Cohort Operations — Suspend and Remove

Sprint use case IDs are scoped to this sprint (SUC-008-NNN). They refine and
decompose the design-level use cases UC-013 and UC-014.

---

## SUC-008-001: Admin Views Cohort with Bulk Action Controls

**Derives from:** UC-013, UC-014

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- At least one Cohort exists in the system.

**Main Flow:**
1. Administrator navigates to `/admin/cohorts`.
2. App displays the cohort list. Each cohort row includes a "Bulk Actions"
   dropdown offering four options:
   - Suspend Workspace accounts
   - Suspend Claude seats
   - Remove Workspace accounts
   - Remove Claude seats
3. Administrator selects an action for a cohort to open the confirmation dialog.

**Postconditions:**
- Administrator sees all cohorts with their bulk action affordances.

---

## SUC-008-002: Admin Confirms Cohort Bulk Suspend

**Derives from:** UC-013

**Actor:** Administrator

**Preconditions:**
- Administrator has selected "Suspend Workspace accounts" or "Suspend Claude
  seats" for a cohort.
- The cohort has at least one student with an active ExternalAccount of the
  selected type.

**Main Flow:**
1. App fetches a preview count: the number of active accounts of the selected
   type in this cohort.
2. App displays a confirmation dialog: "Suspend [N] [Workspace / Claude]
   accounts for cohort [Name]? This can be reversed by re-provisioning
   individual accounts."
3. Administrator confirms.
4. App calls `POST /api/admin/cohorts/:id/bulk-suspend` with `{ accountType }`.
5. While the request is in-flight, a spinner is shown and the Confirm button is
   disabled.
6. On completion, the dialog closes and a result summary is shown: N succeeded,
   M failed. Each failure lists the user name and error message.

**Postconditions:**
- All targeted active ExternalAccounts in the cohort have status=suspended.
- One AuditEvent per suspended account is recorded.
- Per-user failures are visible to the administrator.

**Error Flows:**
- Zero eligible accounts: action button is disabled.
- Partial failure (HTTP 207): mixed result shown with succeeded and failed lists.
- Full failure (HTTP 500): error message shown.

---

## SUC-008-003: Admin Confirms Cohort Bulk Remove

**Derives from:** UC-014

**Actor:** Administrator

**Preconditions:**
- Administrator has selected "Remove Workspace accounts" or "Remove Claude
  seats" for a cohort.
- The cohort has at least one student with an active or suspended ExternalAccount
  of the selected type.

**Main Flow:**
1. App fetches a preview count of eligible accounts (active or suspended).
2. App displays a confirmation dialog with an irreversibility warning:
   "Remove [N] [Workspace / Claude] accounts for cohort [Name]? Workspace
   accounts will be suspended and permanently deleted after 3 days. Claude
   seats are released immediately. This action cannot be undone."
3. Administrator confirms.
4. App calls `POST /api/admin/cohorts/:id/bulk-remove` with `{ accountType }`.
5. Spinner and disabled state while in-flight.
6. On completion, a result summary is shown: N succeeded, M failed.

**Postconditions:**
- All targeted ExternalAccounts in the cohort have status=removed.
- Workspace accounts: suspended immediately, scheduled_delete_at set to
  now + 3 days (picked up by the existing WorkspaceDeleteJob).
- Claude seats: released immediately via ClaudeTeamAdminClient.removeMember.
- One AuditEvent per removed account.

**Error Flows:**
- Zero eligible accounts: action button disabled.
- Partial failure (HTTP 207): mixed result shown.
- Full failure (HTTP 500): error message shown.

---

## SUC-008-004: BulkCohortService Iterates Cohort and Applies Lifecycle Operation

**Derives from:** UC-013, UC-014

**Actor:** System (invoked by bulk-suspend or bulk-remove route handler)

**Preconditions:**
- A valid cohortId, accountType, and actorId are supplied.

**Main Flow:**
1. Service loads all active Users belonging to the cohort
   (cohort_id = cohortId, is_active = true).
2. For each user, loads all ExternalAccounts of the requested type with
   status in the eligible set (active for suspend; active or suspended for
   remove).
3. For each eligible account, calls
   `ExternalAccountLifecycleService.suspend(accountId, actorId, tx)` or
   `.remove(accountId, actorId, tx)` inside an individual `prisma.$transaction`.
4. If a per-account call throws, the error is caught and appended to a failures
   list; the loop continues.
5. Returns:
   `{ succeeded: number[]; failed: { accountId: number; userId: number; userName: string; error: string }[] }`.

**Postconditions:**
- Each successfully processed account has its status updated and an AuditEvent
  recorded (inside ExternalAccountLifecycleService, one per account).
- Failures do not abort processing of subsequent accounts.

**Error Flows:**
- Cohort not found: service throws NotFoundError (route returns 404).
- No eligible accounts: returns `{ succeeded: [], failed: [] }`.

---

## SUC-008-005: Admin Views Per-User Failure Report

**Derives from:** UC-013, UC-014

**Actor:** Administrator

**Preconditions:**
- A bulk operation has completed with one or more per-account failures
  (HTTP 207 response).

**Main Flow:**
1. UI displays a result panel listing:
   - Count of succeeded accounts.
   - For each failure: user display name and error message.
2. Administrator can dismiss the panel and return to the cohort list.
3. Individual failures can be addressed via existing per-user detail pages.

**Postconditions:**
- No records are changed by viewing the report.

---

## SUC-008-006: Bulk Operation Count Pre-Flight

**Derives from:** UC-013, UC-014

**Actor:** System (invoked by UI to populate confirmation dialog)

**Preconditions:**
- Administrator has selected a bulk action for a cohort.

**Main Flow:**
1. UI calls `GET /api/admin/cohorts/:id/bulk-preview?accountType=workspace|claude&operation=suspend|remove`.
2. Service queries the count of eligible accounts without mutating any record.
3. Returns `{ eligibleCount: number }`.
4. UI uses eligibleCount to populate the confirmation dialog message and
   disable the action button when eligibleCount is 0.

**Postconditions:**
- No records mutated. Count may be slightly stale by the time the admin
  confirms — acceptable.
