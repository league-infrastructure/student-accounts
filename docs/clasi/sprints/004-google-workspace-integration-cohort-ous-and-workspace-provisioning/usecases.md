---
sprint: '004'
status: approved
use-cases:
- UC-005
- UC-012
---

# Sprint 004 — Use Cases

Sprint 004 delivers two use cases that must exist before any other
provisioning can proceed: cohort creation (which creates the Google OU)
and individual League Workspace account provisioning. It also delivers
the admin provisioning-requests view that connects the two.

---

## SUC-001: Admin Creates Cohort (UC-012)

**Spec reference:** UC-012, spec §2.4, §5.3, §6.1

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- The desired cohort name does not conflict with an existing Cohort record.
- The Google Admin SDK is reachable and `GOOGLE_WORKSPACE_WRITE_ENABLED=1`
  is set.
- `GOOGLE_STUDENT_OU_ROOT` is configured (e.g. `/Students`).

**Main Flow:**
1. Administrator navigates to `/admin/cohorts` and clicks "Create Cohort."
2. Administrator enters a cohort name (e.g. "League Lab Summer 26").
3. App validates the name is non-blank and not already used by an existing
   Cohort.
4. App calls `CohortService.createWithOU(name, actorId)`.
5. Service opens a Prisma transaction:
   a. Calls `GoogleWorkspaceAdminClient.createOU(name)` — creates a child
      OU under `GOOGLE_STUDENT_OU_ROOT` in Google Workspace. Derives the
      full `google_ou_path` as `GOOGLE_STUDENT_OU_ROOT + "/" + name`.
   b. Calls `CohortRepository.create({ name, google_ou_path })` inside
      the same transaction.
   c. Records `create_cohort` AuditEvent atomically.
   d. If the Admin SDK call fails before the repo write, the transaction
      is aborted; no Cohort row is created.
6. App responds with the new Cohort record; admin is returned to the
   cohort list.

**Postconditions:**
- A Cohort record exists with `google_ou_path` set to the full OU path.
- The corresponding Google OU exists in Workspace under the student OU root.
- An AuditEvent with action=`create_cohort` is recorded.

**Error Flows:**
- Admin SDK fails (OU already exists, permission denied): transaction
  rolled back; no Cohort row created; error surfaced to the administrator.
- Name is blank or a duplicate of an existing Cohort: validation error
  before any API call.
- `GOOGLE_WORKSPACE_WRITE_ENABLED` is not set: service throws
  `WorkspaceWriteDisabledError`; admin sees a clear message.

**Out of scope for this sprint:**
- Editing or deleting cohorts.
- Assigning students to a cohort from the cohort detail view.
- Bulk cohort operations (Sprint 008).
- Cohort detail page showing enrolled students (Sprint 009).

---

## SUC-002: Admin Provisions League Workspace Account (UC-005)

**Spec reference:** UC-005, spec §3.2, §6.1

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Target User exists with role=student.
- Target User's cohort has a non-null `google_ou_path`.
- No ExternalAccount with type=workspace and status IN ('pending', 'active')
  already exists for this User.
- `GOOGLE_WORKSPACE_WRITE_ENABLED=1` is set.
- `GOOGLE_STUDENT_DOMAIN` is configured (e.g. `students.jointheleague.org`).

**Main Flow (admin-direct path):**
1. Administrator opens the target User's detail view.
2. Administrator clicks "Provision League Workspace Account."
3. App calls `WorkspaceProvisioningService.provision(userId, actorId, tx)`.
4. Service validates all preconditions.
5. Service calls `GoogleWorkspaceAdminClient.createUser(params)` with:
   - `primaryEmail`: `<slug>@<GOOGLE_STUDENT_DOMAIN>` (slug derived from
     User's display name).
   - `orgUnitPath`: the cohort's `google_ou_path`.
   - `sendNotificationEmail: true` — Google delivers the welcome email
     with a temporary password to the User's `primary_email`.
   - Guard check: client refuses any address not on `GOOGLE_STUDENT_DOMAIN`
     and any OU outside `GOOGLE_STUDENT_OU_ROOT`. Throws
     `WorkspaceDomainGuardError` if violated.
6. Service creates ExternalAccount: type=workspace, status=active,
   external_id=Google Workspace user ID returned by the API.
7. Service calls the Pike13 write-back stub (`pike13Writeback.leagueEmail`),
   which is a no-op this sprint (Sprint 006 fills it in).
8. Service records `provision_workspace` AuditEvent atomically (inside the
   same transaction as the ExternalAccount write).

**Main Flow (via provisioning request approval):**
1. Administrator navigates to `/admin/provisioning-requests`.
2. Admin sees the list of pending requests.
3. Admin clicks "Approve" on a workspace request.
4. Route calls `ProvisioningRequestService.approve(requestId, actorId)`.
5. `approve` sets status=approved, then calls
   `WorkspaceProvisioningService.provision(userId, actorId, tx)` inside
   the same transaction.
6. Steps 4–8 from the direct path execute within that transaction.

**Postconditions:**
- User has an ExternalAccount: type=workspace, status=active,
  external_id=Google Workspace user ID.
- User's `primary_email` is unchanged; the League address is stored on
  the ExternalAccount.
- Google welcome email delivered to User's `primary_email` (by Google).
- AuditEvents recorded: `approve_provisioning_request` (if via request
  path), `provision_workspace`.

**Error Flows:**
- Google Admin SDK returns an error (OU missing, duplicate address): error
  surfaced to the administrator; no ExternalAccount created.
- Precondition fails (no cohort assigned, role is not student, active
  workspace account already exists): action blocked with a descriptive
  message; no API call made.
- Domain guard triggered (attempt outside student domain or student OU
  root): client throws `WorkspaceDomainGuardError`; error surfaced; no
  ExternalAccount row created.
- Write-enable flag absent: `WorkspaceWriteDisabledError`; clear message.

**Out of scope for this sprint:**
- Pike13 write-back of the League email address (Sprint 006 — call site
  exists as no-op stub).
- Claude Team seat provisioning after workspace creation (Sprint 005).
- Suspending or deleting Workspace accounts (Sprint 005/008).
- Admin notification on new provisioning request creation (OQ-001 from
  Sprint 003 — pending stakeholder decision on notification channel).

---

## SUC-003: Admin Reviews Pending Provisioning Requests

**Spec reference:** UC-007 steps 5–6 (admin side), UC-005 approval path.

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- At least one ProvisioningRequest with status=pending exists.

**Main Flow:**
1. Administrator navigates to `/admin/provisioning-requests`.
2. App displays the list of pending requests: student name, request type,
   submitted date.
3. Admin clicks "Approve" — triggers SUC-002 provisioning flow.
4. Admin clicks "Reject" — sets status=rejected; no external SDK call.

**Postconditions (Approve):**
- ProvisioningRequest status=approved (set atomically with provision).
- ExternalAccount created (workspace) per SUC-002 postconditions.
- AuditEvents: `approve_provisioning_request`, `provision_workspace`.

**Postconditions (Reject):**
- ProvisioningRequest status=rejected.
- No ExternalAccount created, no external API called.
- AuditEvent action=`reject_provisioning_request` recorded.

**Out of scope for this sprint:**
- Claude Team seat provisioning via approval flow (Sprint 005).
- Pagination or search/filter on the request list.
- Admin email/badge notification on new request submission.

---

## What Is Explicitly NOT in This Sprint

| Deferred item | Target sprint |
|---|---|
| Pike13 write-back of League email address | Sprint 006 |
| Claude Team seat provisioning | Sprint 005 |
| Merge queue / duplicate detection | Sprint 007 |
| Bulk cohort operations (suspend all, etc.) | Sprint 008 |
| User directory admin UI and user detail view | Sprint 009 |
| Suspending or deleting Workspace accounts | Sprint 005 / 008 |
| Admin notification on provisioning request creation | OQ-001 — pending stakeholder decision |
