---
title: User Account Management — Use Cases
status: active
---

# User Account Management — Use Cases

Use case IDs are stable identifiers. Spec cross-references use the section
numbers from `specification.md`.

---

## UC-001: Social Sign-In — New User Created (Google)

**Actor:** Prospective student (unauthenticated)

**Preconditions:**
- No User record exists matching the Google identity.
- Google OAuth is configured and reachable.

**Main Flow:**
1. Actor navigates to the app and selects "Sign in with Google."
2. App redirects to Google OAuth.
3. Actor authenticates with Google and grants consent.
4. Google returns an identity token containing the actor's Google user ID and
   email address.
5. App looks up an existing Login by provider=google and provider_user_id.
6. No match found. App creates a new User with display_name and primary_email
   from the Google identity, role=student, created_via=social_login.
7. App creates a Login record: provider=google, provider_user_id, provider_email.
8. App runs the merge similarity check against all existing Users (see UC-018).
9. App establishes a session for the new User and redirects to the student
   account page.

**Postconditions:**
- A new User record exists with one Google Login attached.
- Merge suggestions (if any) are queued for administrator review.
- An AuditEvent is recorded for User creation.

**Error Flows:**
- Google OAuth fails or actor denies consent: app returns to sign-in page with
  an error message; no User is created.
- Duplicate Login found (provider_user_id already exists on a different User):
  app signs the actor into the existing User rather than creating a new one.

---

## UC-002: Social Sign-In — New User Created (GitHub)

**Actor:** Prospective student (unauthenticated)

**Preconditions:**
- No User record exists matching the GitHub identity.
- GitHub OAuth is configured and reachable.

**Main Flow:**
1. Actor selects "Sign in with GitHub."
2. App redirects to GitHub OAuth.
3. Actor authenticates and grants consent.
4. GitHub returns an identity token with GitHub user ID, username, and email.
5. App looks up an existing Login by provider=github and provider_user_id.
6. No match found. App creates a new User with primary_email from GitHub,
   role=student, created_via=social_login.
7. App creates a Login record: provider=github, provider_user_id,
   provider_email, GitHub username stored.
8. App runs merge similarity check (see UC-018).
9. App establishes session and redirects to student account page.

**Postconditions:**
- A new User record exists with one GitHub Login attached.
- GitHub username is available for future Pike13 write-back.
- Merge suggestions (if any) are queued.
- AuditEvent recorded for User creation.

**Error Flows:**
- GitHub OAuth fails or actor denies consent: return to sign-in page; no User
  created.
- Duplicate Login found: sign actor into existing User.

---

## UC-003: Staff Sign-In via League Staff OU

**Actor:** League staff member (unauthenticated)

**Preconditions:**
- Actor has a `@jointheleague.org` Google Workspace account.
- Actor's Google account is a member of the League staff OU.

**Main Flow:**
1. Actor navigates to the app and selects "Sign in with Google."
2. App redirects to Google OAuth.
3. Actor authenticates with their `@jointheleague.org` account.
4. Google returns an identity token.
5. App looks up or creates a User for this Google identity (same Login lookup
   as UC-001 steps 5–6).
6. App reads the actor's OU membership via the Google Admin SDK.
7. OU membership confirms the actor is in the League staff OU
   (`@jointheleague.org`, not the student domain). App sets role=staff on the
   User record (or confirms it is already staff).
8. App establishes a session with staff privileges and redirects to the staff
   read-only directory view showing all students org-wide (per §8, decision 3).

**Postconditions:**
- Staff User has exactly one Login (their League Google account).
- No External Accounts are associated with the staff User.
- Staff sees the org-wide student list, read-only. No per-cohort restriction
  applies (§8, decision 3).

**Error Flows:**
- Actor authenticates with a `@jointheleague.org` account but is NOT in the
  staff OU: app denies access or treats actor as a plain student (behavior to
  be confirmed in build spec).
- Actor authenticates with a `@students.jointheleague.org` account: treated as
  a student, not staff.
- Google Admin SDK call to read OU membership fails: app cannot confirm staff
  status; access denied with an error message.

---

## UC-004: Pike13 Sync — Creates Unmatched Users

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- The Pike13 API is reachable.
- At least one Pike13 person record exists that has no matching User.

**Main Flow:**
1. Administrator initiates a Pike13 sync (manually or via scheduled trigger).
2. App calls the Pike13 API to list/search people.
3. For each Pike13 person, app checks for an existing User with that Pike13 ID
   or matching email.
4. For each unmatched Pike13 person: app creates a new User with
   display_name and primary_email from the Pike13 record,
   created_via=pike13_sync. App creates an ExternalAccount record:
   type=pike13, external_id=Pike13 person ID, status=active.
5. App runs merge similarity check for each newly created User (see UC-018).
6. Sync completes. App reports counts: created, matched, skipped, errors.

**Postconditions:**
- New User records exist for each unmatched Pike13 person.
- Each new User has a Pike13 ExternalAccount but no Login.
- Merge suggestions (if any) are queued.
- AuditEvent recorded for each User creation and for the sync operation.

**Error Flows:**
- Pike13 API is unreachable or returns an error: sync aborts; partial results
  (if any) are rolled back or flagged.
- Pike13 person record is missing required fields (name or email): that record
  is skipped and logged; sync continues for remaining records.

---

## UC-005: Admin Provisions League Workspace Account

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User exists, has role=student, belongs to a cohort that has a Google
  OU path.
- No League Workspace ExternalAccount (type=workspace) already exists and is
  active for this User.

**Main Flow:**
1. Administrator opens the target User's detail view.
2. Administrator clicks "Provision League Workspace Account."
3. App validates preconditions (student role, cohort with OU, no existing
   active workspace account).
4. App calls the Google Admin SDK to create a user on
   `@students.jointheleague.org` in the OU corresponding to the User's cohort.
   The `sendNotificationEmail` option is set; Google delivers the welcome
   email with temporary password to the User's primary email.
5. App creates an ExternalAccount record: type=workspace, status=active,
   external_id=Google Workspace user ID.
6. App writes the new League email address back to the User's Pike13 record
   (custom field "League Email Address"), if the User has a linked Pike13
   ExternalAccount (see UC-020).
7. AuditEvent recorded: action=provision_workspace, actor, target_user,
   details including the new email address.

**Postconditions:**
- User has an active League Workspace ExternalAccount.
- User's primary email is unchanged (still the external address); the League
  address is stored on the ExternalAccount.
- Pike13 "League Email Address" field is updated (if Pike13 linked).
- Welcome email delivered by Google to User's primary email.

**Error Flows:**
- Google Admin SDK returns an error (e.g., OU does not exist, duplicate
  address): app surfaces the error to the administrator; no ExternalAccount
  record is created.
- User has no cohort assigned: app blocks the action with a message directing
  the administrator to assign a cohort first.
- App attempts to create an account on `@jointheleague.org` or outside a
  student OU: integration layer refuses; an error is surfaced.

---

## UC-006: Admin Provisions Claude Team Seat

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User exists with role=student.
- Target User has an active League Workspace ExternalAccount (type=workspace).
  A Claude Team seat cannot be provisioned without an active League Workspace
  account — the seat invitation is sent only to the student's League Workspace
  address (§8, decision 1).
- No active Claude Team ExternalAccount (type=claude) already exists for this
  User.

**Main Flow:**
1. Administrator opens the target User's detail view.
2. Administrator clicks "Provision Claude Team Seat."
3. App uses the User's League Workspace address as the invite address. The
   student's external primary email is not used.
4. App calls the Claude Team admin API to invite or add the seat, using the
   League Workspace address only.
5. App creates an ExternalAccount record: type=claude, status=pending (or
   active, depending on API semantics), external_id=seat identifier.
6. AuditEvent recorded: action=provision_claude, actor, target_user.

**Postconditions:**
- User has a Claude Team ExternalAccount in pending or active state.
- Seat invitation delivered to the User's League Workspace inbox only.

**Error Flows:**
- User has no active League Workspace account: action is blocked with a
  message instructing the administrator to provision the Workspace account
  first.
- Claude Team API returns an error: app surfaces error; no ExternalAccount
  created.
- User already has an active Claude seat: action blocked with a message.

---

## UC-007: Student Self-Service Request — League Email (or League Email + Claude Seat)

**Actor:** Student

**Preconditions:**
- Student is signed in.
- Student does not already have an active League Workspace ExternalAccount.

**Main Flow:**

*Option A — Request League email only:*
1. Student views their account page, Services section.
2. Student clicks "Request League Email."
3. App creates a ProvisioningRequest: type=workspace, status=pending.
4. AuditEvent recorded for the request creation.
5. App notifies an administrator (method TBD in build spec).
6. Administrator reviews the request and, on approval, executes UC-005.

*Option B — Request League email and Claude Team seat together:*
1. Student views their account page, Services section.
2. "Request Claude Team Seat" option is shown only if the student has already
   requested or has an active League email. If neither condition is met, the
   Claude seat option is unavailable (greyed out or hidden).
3. Student clicks "Request League Email + Claude Seat."
4. App creates two ProvisioningRequests: type=workspace and type=claude, both
   status=pending and linked.
5. AuditEvent recorded.
6. Administrator approves and executes: UC-005 first, then UC-006.

**Postconditions:**
- One or two ProvisioningRequest records created in pending state.
- Student's account page reflects pending status for the requested service(s).

**Error Flows:**
- Student attempts to request a Claude seat without a League email (or pending
  League email request): app enforces the constraint; Claude seat request is
  not submitted.

---

## UC-008: Admin Adds Login on User's Behalf

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User exists.
- The Login to be added (provider + provider_user_id) is not already attached
  to any User.

**Main Flow:**
1. Administrator opens the target User's detail view.
2. Administrator selects "Add Login" and chooses provider (Google or GitHub)
   and supplies the provider identity.
3. App validates that the provider_user_id is not already in use.
4. App creates a Login record attached to the target User.
5. If provider=github: app writes the GitHub username to the User's Pike13
   record (custom field "GitHub Username"), if Pike13 is linked (see UC-020).
6. AuditEvent recorded: action=add_login, actor, target_user, provider.

**Postconditions:**
- Target User has one additional Login.
- Pike13 GitHub Username field updated (if applicable).

**Error Flows:**
- Provider_user_id already exists on another User: action blocked; admin is
  directed to use the merge workflow if appropriate.

---

## UC-009: Admin Removes Login on User's Behalf

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User has at least two Logins.

**Main Flow:**
1. Administrator opens the target User's detail view, Logins section.
2. Administrator clicks "Remove" on the Login to be removed.
3. App verifies the User will have at least one Login remaining.
4. App deletes the Login record.
5. AuditEvent recorded: action=remove_login, actor, target_user, provider.

**Postconditions:**
- Target User has one fewer Login; at least one remains.

**Error Flows:**
- Target User has only one Login: remove action is blocked. Admin must add a
  replacement Login before removing the last one.

---

## UC-010: Student Adds Own Login

**Actor:** Student

**Preconditions:**
- Student is signed in.
- The Login to be added is not already attached to any User.

**Main Flow:**
1. Student views their account page, Logins section.
2. Student clicks "Add [Google / GitHub]."
3. App initiates the OAuth flow for the chosen provider.
4. Provider returns identity. App validates provider_user_id is not in use.
5. App creates a Login record attached to the student's User.
6. If provider=github: app writes GitHub username to the User's Pike13 record
   (custom field "GitHub Username"), if Pike13 is linked.
7. AuditEvent recorded.

**Postconditions:**
- Student's User has one additional Login.

**Error Flows:**
- Provider OAuth fails: no Login created; student returned to account page
  with error.
- Provider_user_id already in use on another User: action blocked; student
  directed to contact an administrator.

---

## UC-011: Student Removes Own Login

**Actor:** Student

**Preconditions:**
- Student is signed in.
- Student's User has at least two Logins.

**Main Flow:**
1. Student views their account page, Logins section.
2. Student clicks "Remove" on one of their Logins (not the one used for the
   current session, or app handles session management gracefully).
3. App verifies at least one Login will remain.
4. App deletes the Login record.
5. AuditEvent recorded.

**Postconditions:**
- Student's User has one fewer Login; at least one remains.

**Error Flows:**
- Student's User has only one Login: remove action is blocked with a message
  explaining that at least one Login must be kept.

---

## UC-012: Admin Creates Cohort

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- The desired cohort name does not conflict with an existing cohort.
- The Google Admin SDK is reachable.

**Main Flow:**
1. Administrator navigates to Cohort Management and clicks "Create Cohort."
2. Administrator enters cohort name (e.g., "League Lab Summer 26").
3. App calls the Google Admin SDK to create an OU as a child of the student OU
   root, named after the cohort.
4. App creates a Cohort record: name, google_ou_path from the newly created OU.
5. AuditEvent recorded: action=create_cohort, actor, cohort name.

**Postconditions:**
- A new Cohort record exists with a valid google_ou_path.
- The corresponding Google OU exists in Workspace.

**Error Flows:**
- Google Admin SDK returns an error (e.g., OU already exists, permission
  denied): app surfaces error; no Cohort record is created.
- Cohort name is blank or invalid: app validates before calling the API.

---

## UC-013: Cohort Bulk Suspend

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target cohort exists with at least one student who has active External
  Accounts of the type being suspended.

**Main Flow:**
1. Administrator opens the Cohort Management view for the target cohort.
2. Administrator selects a bulk action, e.g., "Suspend all Claude Team seats"
   or "Suspend all League Workspace accounts."
3. App presents a confirmation dialog listing the number of affected accounts.
4. Administrator confirms.
5. App iterates over all Users in the cohort with active ExternalAccounts of
   the selected type.
6. For each account, app calls the appropriate API to suspend (Google Workspace
   suspend or Claude Team suspend).
7. App updates each ExternalAccount record: status=suspended.
8. One AuditEvent recorded per suspended account:
   action=suspend_workspace or action=suspend_claude, actor, target_user,
   cohort.

**Postconditions:**
- All targeted ExternalAccounts in the cohort are in status=suspended.
- AuditEvents recorded for each.

**Error Flows:**
- API call fails for one or more accounts: failures are collected and reported
  to the administrator after the batch; successful suspensions are not rolled
  back.

---

## UC-014: Cohort Bulk Remove

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target cohort exists with at least one student who has active or suspended
  External Accounts of the type being removed.

**Main Flow:**
1. Administrator opens the Cohort Management view for the target cohort.
2. Administrator selects a bulk remove action, e.g., "Remove all from
   workspace" or "Remove all Claude seats."
3. App presents a confirmation dialog. Warning: removal is not reversible
   (Google accounts follow the suspend-then-delete 3-day retention; Claude
   seats are immediately released).
4. Administrator confirms.
5. App iterates over all Users in the cohort with applicable ExternalAccounts.
6. For each account:
   - League Workspace: suspend immediately (if not already suspended), schedule
     deletion in 3 days.
   - Claude Team seat: call API to remove seat from workspace.
7. App updates each ExternalAccount record: status=removed.
8. One AuditEvent recorded per removed account.

**Postconditions:**
- All targeted ExternalAccounts in the cohort are in status=removed.
- Google Workspace accounts are suspended and queued for deletion in 3 days.
- Claude Team seats are released.

**Error Flows:**
- API call fails for one or more accounts: failures collected and reported;
  successful removals not rolled back.

---

## UC-015: Individual Suspend — External Account (Suspend-and-Preserve)

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User has an active ExternalAccount of the type to be suspended.

**Main Flow:**
1. Administrator opens the User's detail view.
2. Administrator clicks "Suspend" on the target ExternalAccount.
3. App presents a confirmation.
4. Administrator confirms.
5. App calls the appropriate external API to suspend the account or seat.
6. App updates ExternalAccount: status=suspended.
7. AuditEvent recorded: action=suspend, actor, target_user, account_type.

**Postconditions:**
- ExternalAccount is in status=suspended. Data is preserved. Action is
  reversible.

**Error Flows:**
- API call fails: ExternalAccount status is not changed; error surfaced to
  administrator.

---

## UC-016: Individual Remove — External Account (Remove from Workspace)

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User has an active or suspended ExternalAccount.

**Main Flow:**
1. Administrator opens the User's detail view.
2. Administrator clicks "Remove" on the target ExternalAccount.
3. App presents a confirmation dialog with a warning that removal is not
   reversible.
4. Administrator confirms.
5. For League Workspace account:
   a. If not already suspended, app calls Google Admin SDK to suspend
      immediately.
   b. App schedules deletion 3 days later.
   c. App updates ExternalAccount: status=removed (with deletion scheduled
      timestamp).
6. For Claude Team seat:
   a. App calls Claude Team API to remove the seat.
   b. App updates ExternalAccount: status=removed.
7. AuditEvent recorded: action=remove, actor, target_user, account_type.

**Postconditions:**
- ExternalAccount is in status=removed.
- Google Workspace account: suspended immediately, deleted after 3 days.
- Claude Team seat: released from workspace.

**Error Flows:**
- API call fails: status not changed; error surfaced to administrator.

---

## UC-017: Deprovision Student Leaving School

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Student User exists with any combination of active External Accounts.

**Main Flow:**
1. Administrator opens the departing student's User detail view.
2. For each active ExternalAccount:
   - League Workspace account: administrator executes UC-016 (remove from
     workspace, 3-day deletion schedule).
   - Claude Team seat: administrator executes UC-016 (remove seat).
3. Pike13 ExternalAccount: left untouched.
4. GitHub Login: left untouched (student owns the account).
5. AuditEvent recorded for each removal action.

**Postconditions:**
- League Workspace account is suspended and scheduled for deletion in 3 days.
- Claude Team seat is removed.
- Pike13 and GitHub records remain linked to the User record.

**Error Flows:**
- Individual API calls may fail; each is handled per UC-016 error flow.

---

## UC-018: Merge Suggestion Generated by Haiku on User Creation

**Actor:** System (triggered on User creation)

**Preconditions:**
- A new User record has just been created (via any of UC-001, UC-002, UC-004).
- At least one other User record exists in the system.
- The Anthropic API (Claude Haiku) is reachable.

**Main Flow:**
1. On User creation, app collects all existing User records (or a relevant
   subset) as merge candidates.
2. For each candidate pair (new User, existing User), app constructs a prompt
   containing both records' names, emails, Pike13 ID (if present), cohort,
   and creation date.
3. App calls the Anthropic API with the Claude Haiku model to evaluate the
   pair.
4. Haiku returns a confidence score (0.0–1.0) and a short rationale string.
5. If confidence >= 0.6: app creates a MergeSuggestion record: status=pending,
   haiku_confidence, haiku_rationale.
6. If confidence < 0.6: the pair is discarded; no record created. No
   intermediate tier exists (§8, decision 7).
7. AuditEvent recorded for each suggestion created.

**Postconditions:**
- Zero or more MergeSuggestion records in status=pending, visible in the
  administrator merge queue.

**Error Flows:**
- Anthropic API call fails or times out: suggestion is not created for that
  pair; the failure is logged; User creation succeeds regardless.

---

## UC-019: Admin Reviews Merge Queue

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- At least one MergeSuggestion exists in status=pending.

**Main Flow:**
1. Administrator navigates to the Merge Queue.
2. App displays the list of pending suggestions with Haiku confidence score
   and rationale.
3. Administrator selects a suggestion to review.
4. App displays a side-by-side comparison of User A and User B: profile,
   Logins, External Accounts, cohort, creation date.
5. Administrator chooses one of three actions:

   *Approve:*
   a. Administrator confirms which User record is the survivor.
   b. App merges: all Logins from the non-surviving User are moved to the
      survivor. All ExternalAccounts from the non-surviving User are moved to
      the survivor. Cohort assignment: survivor's cohort is retained (or
      administrator selects). Non-surviving User record is deactivated/deleted.
   c. MergeSuggestion: status=approved, decided_by, decided_at.
   d. AuditEvent recorded: action=merge_approve, actor, user_a, user_b,
      survivor_id.

   *Reject:*
   a. App marks MergeSuggestion: status=rejected, decided_by, decided_at.
   b. AuditEvent recorded: action=merge_reject, actor, user_a, user_b.

   *Defer:*
   a. App marks MergeSuggestion: status=deferred.
   b. Suggestion remains visible in the queue for future review.

**Postconditions (Approve):**
- Surviving User has all Logins and External Accounts from both records.
- Non-surviving User is deactivated.
- AuditEvent recorded.

**Postconditions (Reject/Defer):**
- Both User records remain unchanged.

**Error Flows:**
- Merge operation fails mid-way (e.g., duplicate Login constraint): transaction
  is rolled back; both User records remain intact; error surfaced to
  administrator.

---

## UC-020: Pike13 Write-Back of GitHub Handle and League Email

**Actor:** System (triggered on Login or ExternalAccount creation)

**Preconditions:**
- A User has a linked Pike13 ExternalAccount (type=pike13, status=active).
- A GitHub Login was just added to the User (UC-008 or UC-010), OR a League
  Workspace ExternalAccount was just created (UC-005).

**Main Flow:**

*GitHub handle write-back:*
1. After a GitHub Login is created for a User, app checks whether the User has
   a linked Pike13 ExternalAccount.
2. If yes: app calls the Pike13 API to update the "GitHub Username" custom
   field on the person record with the GitHub username from the Login.
3. AuditEvent recorded: action=pike13_writeback_github, actor or system,
   target_user.

*League email write-back:*
1. After a League Workspace ExternalAccount becomes active for a User, app
   checks whether the User has a linked Pike13 ExternalAccount.
2. If yes: app calls the Pike13 API to update the "League Email Address"
   custom field on the person record.
3. AuditEvent recorded: action=pike13_writeback_email, actor or system,
   target_user.

**Postconditions:**
- Pike13 person record has updated custom field(s) visible to parents.

**Error Flows:**
- Pike13 API call fails: the primary action (Login or ExternalAccount creation)
  is not rolled back; the write-back failure is logged and surfaced to the
  administrator or retried.

---

## UC-021: Audit Log Recording for Admin Action

**Actor:** System (triggered by any administrative action)

**Preconditions:**
- Any action that modifies a User, Login, ExternalAccount, Cohort, or
  MergeSuggestion is performed by an actor with role=admin (or system for
  automated actions).

**Main Flow:**
1. The triggering action completes (or is attempted).
2. App creates an AuditEvent record:
   - actor_user_id: the administrator (or null for system actions).
   - action: a structured action string (e.g., provision_workspace,
     suspend_claude, merge_approve, add_login, create_cohort).
   - target_user_id: the affected User (if applicable).
   - target_entity_type + target_entity_id: the specific record affected.
   - details: JSON blob with action-specific data (new status, email address,
     merge rationale, etc.).
   - created_at: timestamp.
3. AuditEvent is committed atomically with the triggering change (same
   transaction, or compensating write on failure).

**Postconditions:**
- An AuditEvent record exists for every administrative action.

**Error Flows:**
- AuditEvent write fails: the triggering action is rolled back (audit integrity
  is mandatory). Error is surfaced to the actor.

---

## UC-022: Staff Read-Only Directory View

**Actor:** Staff member

**Preconditions:**
- Staff member is signed in (via UC-003).
- Staff member has role=staff.

**Main Flow:**
1. Staff member navigates to the student directory.
2. App displays a list of all Users with role=student across the organization
   (org-wide — no per-cohort restriction; per §8, decision 3).
3. Staff member can search and filter by name, cohort, External Account status.
4. Staff member selects a student to view their profile.
5. App displays the student's profile, cohort, and External Account status
   (name and status only — no provisioning actions, no merge actions, no audit
   log access).

**Postconditions:**
- Staff member viewed student data. No changes to any records.

**Error Flows:**
- Staff member attempts any write or provisioning action: app blocks the
  request and returns a 403 or equivalent.

---

## UC-023: Audit Log Search

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- AuditEvent records exist.

**Main Flow:**
1. Administrator navigates to the Audit Log view.
2. Administrator applies one or more filters:
   - By target User (name or ID).
   - By actor (administrator who performed the action).
   - By action type (provision_workspace, suspend_claude, merge_approve, etc.).
   - By date range (start date, end date).
3. App queries AuditEvents matching all supplied filters.
4. App displays results in reverse chronological order, showing: timestamp,
   actor, action, target User, details summary.
5. Administrator can click an entry to view the full details JSON.

**Postconditions:**
- Administrator viewed matching audit records. No changes to any records.

---

## UC-024: User Views Personal Dashboard

**Actor:** Authenticated user (student, staff, or admin)

**Preconditions:**
- User is signed in via any supported sign-in method.
- User has role=student, role=staff, or role=admin.

**Main Flow:**
1. User navigates to `/account` (or is redirected there after sign-in).
2. App calls `GET /api/account/apps` with the user's session.
3. Server computes the tile list from the user's role and LLM proxy grant
   status (see `app-tiles.service.ts`).
4. Client renders a tile grid with one card per entitled sub-application.
   Each card shows an icon, title, description, and link.
5. User clicks a tile to navigate to the corresponding sub-application.

**Postconditions:**
- User is on the sub-application page they selected.
- No records are modified by viewing the dashboard.

**Error Flows:**
- Unauthenticated request to `/api/account/apps`: server returns 401.
- No tiles available (e.g., a student without an LLM proxy token): app
  renders an empty-state message.

---

## UC-025: Admin Opens User Management Sub-App

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in (role=admin).
- Administrator is on the `/account` dashboard.

**Main Flow:**
1. Administrator sees the User Management tile in the Apps zone.
2. Administrator clicks the tile.
3. App navigates to `/admin/users`.
4. Administrator manages student, staff, and admin accounts as before.

**Postconditions:**
- Administrator is on `/admin/users` and can perform user management.

**Error Flows:**
- Non-admin attempts to access `/admin/users` directly: returns 403.

---

## UC-026: Student Opens LLM Proxy Sub-App

**Actor:** Student with an active LLM proxy token

**Preconditions:**
- Student is signed in (role=student).
- Student has an active (non-revoked, non-expired) LlmProxyToken.
- Student is on the `/account` dashboard.

**Main Flow:**
1. Student sees the LLM Proxy tile in the Apps zone (tile appears because
   the server detected an active token).
2. Student clicks the tile.
3. App navigates to `/account#llm-proxy`.
4. Student views proxy endpoint URL and token information.

**Postconditions:**
- Student viewed their LLM proxy configuration.

**Error Flows:**
- Student has no active token: LLM Proxy tile is not shown; `/account#llm-proxy`
  section shows the "not enabled" state if navigated to directly.

**Error Flows:**
- No records match the filter: app displays an empty result with a message.
- Query performance degrades on large datasets: addressed in the build spec
  (indexing strategy).
