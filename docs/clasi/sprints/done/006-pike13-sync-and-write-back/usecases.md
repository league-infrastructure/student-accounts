---
sprint: "006"
status: final
---

# Sprint 006 Use Cases

Sprint 006 delivers three epics. UC-004 and UC-020 are defined in the master
use-case list (`docs/clasi/design/usecases.md`); summaries are reproduced here
for planning convenience. SUC-001 through SUC-004 are sprint-local use cases for
Google Workspace sync (not yet in the master list).

---

## UC-004: Pike13 Sync — Creates Unmatched Users

*(defined in master usecases.md)*

**Actor:** Administrator

**Summary:** Administrator initiates a Pike13 sync (manually via admin UI).
App calls Pike13 API to list all people. For each person, app checks for an
existing User with a matching Pike13 ExternalAccount external_id or a matching
primary_email. For unmatched records: creates User (created_via=pike13_sync)
and ExternalAccount (type=pike13, external_id=Pike13 person ID, status=active).
Runs merge similarity stub for each new User. Reports created/matched/skipped/
error counts. AuditEvent recorded for each User creation and for the sync
operation itself.

**Acceptance Criteria:**
- [ ] Sync can be triggered from the admin Sync page.
- [ ] Unmatched Pike13 people create User + ExternalAccount rows.
- [ ] Already-matched people are counted as matched, not duplicated.
- [ ] Merge similarity stub is called for each new User.
- [ ] Count report (created/matched/skipped/errors) is returned.
- [ ] AuditEvent recorded per new User and for the overall sync.
- [ ] Pike13 API unreachable: sync aborts with error message.
- [ ] Person record missing name or email: skipped, counted, sync continues.

---

## UC-020: Pike13 Write-Back of GitHub Handle and League Email

*(defined in master usecases.md)*

**Actor:** System (triggered after Login or ExternalAccount creation)

**Summary — GitHub handle write-back:** After a GitHub Login is created for a
User (via admin-add or student self-service OAuth), app checks whether the User
has an active Pike13 ExternalAccount. If yes: calls Pike13 API to update the
"GitHub Username" custom field with the Login's provider_username. AuditEvent
action=pike13_writeback_github recorded.

**Summary — League email write-back:** After a League Workspace ExternalAccount
is created as active for a User (via UC-005 provisioning), app checks whether
the User has an active Pike13 ExternalAccount. If yes: calls Pike13 API to
update the "League Email Address" custom field with the workspace email address.
AuditEvent action=pike13_writeback_email recorded.

**Acceptance Criteria:**
- [ ] Stub module `pike13-writeback.stub.ts` is replaced by a real implementation
  at the same import path.
- [ ] GitHub write-back fires after admin-add and student self-service GitHub login.
- [ ] Email write-back fires after WorkspaceProvisioningService.provision.
- [ ] If User has no Pike13 ExternalAccount: write-back is silently skipped.
- [ ] Pike13 API failure does not roll back the primary action.
- [ ] AuditEvent recorded for each successful write-back.
- [ ] Write-back failure is logged at ERROR and surfaced in admin notifications.

---

## SUC-001: Workspace Sync Cohorts

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- `GOOGLE_STUDENT_OU_ROOT` is set (default `/Students`).
- Google Admin SDK is reachable.

**Main Flow:**
1. Administrator navigates to the admin Sync page and clicks "Sync Cohorts."
2. App calls `GoogleWorkspaceAdminClient.listOUs(studentRoot)`.
3. For each child OU returned:
   - If a Cohort with `google_ou_path` matching the OU path exists: update
     `name` if it has changed.
   - If no Cohort matches: create a new Cohort row with `name` from the OU
     name and `google_ou_path` set. Do NOT call `createOU` — the OU already
     exists in Workspace.
4. App returns counts: created, updated, unchanged.
5. AuditEvent recorded: action=sync_cohorts_completed, details include counts.

**Postconditions:**
- Cohort rows exist for all sub-OUs of `GOOGLE_STUDENT_OU_ROOT`.
- No Google Workspace state is modified.

**Acceptance Criteria:**
- [ ] `listOUs` is added to `GoogleWorkspaceAdminClient` and the fake.
- [ ] Sub-OUs not yet in the DB produce new Cohort rows.
- [ ] Existing Cohorts with matching `google_ou_path` are updated (name sync),
  not duplicated.
- [ ] No `createOU` call is made.
- [ ] Count report returned and AuditEvent recorded.
- [ ] Admin SDK failure: sync aborts, error surfaced, no partial rows written.

---

## SUC-002: Workspace Sync Staff

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- `GOOGLE_STAFF_OU_PATH` is configured.
- Google Admin SDK is reachable.

**Main Flow:**
1. Administrator clicks "Sync Staff."
2. App calls `listUsersInOU(GOOGLE_STAFF_OU_PATH)`.
3. For each Workspace user:
   a. Look up User by `primary_email`.
   b. Existing User with role=admin: skip — never downgrade.
   c. Existing User with role != admin: ensure role=staff.
   d. No matching User: create User (role=staff, created_via=workspace_sync,
      display_name from Workspace givenName + familyName).
4. Returns counts: created, updated, unchanged.
5. AuditEvent recorded: action=sync_staff_completed.

**Postconditions:**
- User rows exist for all users in the staff OU with role=staff.
- No ExternalAccount rows created.
- No User rows deleted.
- Admin role is never downgraded.

**Acceptance Criteria:**
- [ ] Users in the staff OU who are not in the DB are created with role=staff.
- [ ] Existing users with role != admin are updated to role=staff.
- [ ] Existing admins are skipped, not downgraded.
- [ ] No ExternalAccount rows are created.
- [ ] `GOOGLE_STAFF_OU_PATH` unset: sync skipped with informational message.
- [ ] AuditEvent recorded with counts.

---

## SUC-003: Workspace Sync Students

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in with role=admin.
- Google Admin SDK is reachable.

**Main Flow:**
1. Administrator clicks "Sync Students."
2. App calls `listUsersInOU(studentRoot)` — users directly in the root OU
   (no cohort). For each: upsert User with cohort_id=null.
3. For each Cohort with a non-null `google_ou_path`:
   a. App calls `listUsersInOU(cohort.google_ou_path)`.
   b. For each user: look up by primary_email.
      - role=admin: skip.
      - role=staff: skip (do not change role).
      - role=student, found: update cohort_id to this cohort's id.
      - not found: create User (role=student, created_via=workspace_sync,
        cohort_id=this cohort's id).
4. Build set of all email addresses seen in the combined listings.
   For each ExternalAccount (type=workspace, status=active or pending)
   whose user's primary_email is NOT in the seen set: set status=removed,
   emit action=workspace_sync_flagged AuditEvent.
5. Returns counts: created, updated, unchanged, flagged.
6. AuditEvent recorded: action=sync_students_completed.

**Postconditions:**
- User rows exist for all students across all cohort OUs and the root OU.
- Students' cohort_id reflects their OU placement.
- Workspace ExternalAccounts of students no longer in any OU are flagged removed.
- No User rows deleted.

**Acceptance Criteria:**
- [ ] Students in cohort OUs are upserted with correct cohort_id.
- [ ] Students directly in the root OU get cohort_id=null.
- [ ] Existing admins and staff are skipped.
- [ ] Workspace ExternalAccounts not seen in the OU listing are flagged removed.
- [ ] Flagged accounts appear in the sync result panel.
- [ ] No User rows deleted.
- [ ] AuditEvent recorded per flagged account and for the overall sync.

---

## SUC-004: Workspace Sync All

**Actor:** Administrator

**Preconditions:**
- Same combined preconditions as SUC-001, SUC-002, SUC-003.

**Main Flow:**
1. Administrator clicks "Sync All."
2. App runs syncCohorts (SUC-001), then syncStaff (SUC-002), then
   syncStudents (SUC-003) in sequence.
3. Combined count report returned covering all three operations.
4. AuditEvent recorded: action=sync_all_completed.

**Postconditions:**
- All postconditions of SUC-001, SUC-002, and SUC-003 are satisfied.

**Acceptance Criteria:**
- [ ] All three sub-operations run in order.
- [ ] Failure of one sub-operation is recorded; remaining operations still run.
- [ ] Combined report covers per-operation counts and errors.
- [ ] AuditEvent recorded.
