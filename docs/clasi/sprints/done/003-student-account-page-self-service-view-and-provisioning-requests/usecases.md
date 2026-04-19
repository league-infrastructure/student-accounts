---
sprint: '003'
status: approved
---

# Sprint 003 — Use Cases

---

## SUC-001: Student Views Account Page

**Maps to:** Spec §4
**Actor:** Student (authenticated, role=student)

**Preconditions:**
- Student is signed in.
- Student has a User record with at least one Login.

**Scope (this sprint):**
1. Student navigates to `/account`.
2. App loads profile data, logins, external accounts, and provisioning
   requests for the signed-in user via `GET /api/account`.
3. Page renders four sections: Profile, Logins, Services, Help.
4. Profile section shows: display name, primary email, cohort name (or
   "No cohort assigned").
5. Services section shows each service row (League Email, Claude Seat,
   Pike13) with its current status — no external account, pending,
   active, suspended, removed, or rejected provisioning request.
6. Help section shows a contact link or mailto button for admin assistance.

**Postconditions:**
- Student has viewed their account state. No records changed.

**Acceptance Criteria:**
- [ ] GET /api/account returns profile, logins, externalAccounts, and
      provisioningRequests for the signed-in user.
- [ ] Staff users visiting /account are redirected to /staff.
- [ ] Non-authenticated requests to GET /api/account return 401.
- [ ] A student cannot see another student's data (scope enforced by
      binding all queries to req.session.userId).

---

## SUC-002: Student Adds Own Login (UC-010)

**Maps to:** UC-010, Spec §2.2
**Actor:** Student (authenticated, role=student)

**Preconditions:**
- Student is signed in.
- Student does not already have a Login for the provider they want to add.
- The provider OAuth app is configured (returns 501 gracefully otherwise).

**Scope (this sprint):**
1. Student views the Logins section of their account page.
2. "Add Google" or "Add GitHub" button is shown for each provider the
   student does not already have linked, when that provider is configured.
3. Student clicks "Add [Provider]."
4. Browser navigates to `/api/auth/google?link=1` or
   `/api/auth/github?link=1` (the Sprint 002 link-mode hook).
5. OAuth round-trip completes; the server link-mode handler attaches the
   new Login to the current User instead of creating a new User.
6. Server records an `add_login` AuditEvent atomically with Login creation.
7. Browser is redirected back to `/account`; the new provider appears.

**Postconditions:**
- Student's User has one additional Login.
- AuditEvent recorded.

**Acceptance Criteria:**
- [ ] Link-mode OAuth flow (?link=1) attaches a new Login to the current
      User and does not create a new User.
- [ ] If the provider_user_id is already claimed by another User, the
      server returns an error and no Login is created.
- [ ] AuditEvent action=add_login is recorded atomically.
- [ ] After redirect, the new provider appears in the Logins section.

**Out of scope:**
- Pike13 write-back of GitHub handle on Login add (Sprint 006).

---

## SUC-003: Student Removes Own Login (UC-011)

**Maps to:** UC-011, Spec §2.2
**Actor:** Student (authenticated, role=student)

**Preconditions:**
- Student is signed in.
- Student has at least two Logins.

**Scope (this sprint):**
1. Student views the Logins section. The "Remove" button is disabled (and
   the API rejects the request) when only one Login remains.
2. Student clicks "Remove" on a Login.
3. Browser calls `DELETE /api/account/logins/:id`.
4. Server verifies the Login belongs to the signed-in user.
5. Server verifies at least one Login will remain; returns 409 otherwise.
6. Server deletes the Login and records a `remove_login` AuditEvent.
7. Account page reflects the removal.

**Postconditions:**
- Student's User has one fewer Login; at least one remains.
- AuditEvent recorded.

**Acceptance Criteria:**
- [ ] DELETE /api/account/logins/:id succeeds when user has >= 2 logins.
- [ ] Returns 409 when user has exactly 1 login.
- [ ] Returns 403/404 when login_id does not belong to the current user.
- [ ] AuditEvent action=remove_login is recorded atomically.
- [ ] Remove button is disabled in the UI when only one Login is linked.

---

## SUC-004: Student Requests League Email (UC-007, Option A)

**Maps to:** UC-007 Option A, Spec §4, §8.6
**Actor:** Student (authenticated, role=student)

**Preconditions:**
- Student is signed in.
- Student does not have an active or pending League Workspace
  ExternalAccount, and no pending ProvisioningRequest of type=workspace.

**Scope (this sprint):**
1. Student views the Services section. "Request League Email" button is
   shown when no active/pending workspace account or workspace request exists.
2. Student clicks "Request League Email."
3. Browser calls `POST /api/account/provisioning-requests` with body
   `{ "requestType": "workspace" }`.
4. Server creates one ProvisioningRequest: type=workspace, status=pending.
5. Server records a `create_provisioning_request` AuditEvent atomically.
6. Services section updates to show pending status for League Email.

**Postconditions:**
- ProvisioningRequest type=workspace in status=pending.
- AuditEvent recorded.

**Acceptance Criteria:**
- [ ] POST /api/account/provisioning-requests with requestType=workspace
      creates a pending workspace ProvisioningRequest.
- [ ] Returns 409 if a pending or active workspace account/request already
      exists for the user.
- [ ] AuditEvent action=create_provisioning_request recorded.
- [ ] Services section shows "Pending" for League Email after request.

**Out of scope:**
- Administrator notification (seam noted in architecture).
- Administrator approval and actual provisioning (Sprint 004).

---

## SUC-005: Student Requests League Email + Claude Seat Together (UC-007, Option B)

**Maps to:** UC-007 Option B, Spec §4, §8.6
**Actor:** Student (authenticated, role=student)

**Preconditions:**
- Student is signed in.
- Student has a pending or active League email (workspace ProvisioningRequest
  in status=pending or approved, OR ExternalAccount type=workspace in
  status=pending or active). This is the Claude-requires-League-email
  constraint.
- Student does not already have an active or pending Claude seat or
  claude ProvisioningRequest.

**Scope (this sprint):**
1. "Request Claude Seat" option is shown only when the League email
   constraint is satisfied. When the constraint is NOT met, the option is
   absent or visually disabled with explanatory text.
2. Student clicks "Request Email + Claude Seat."
3. Browser calls `POST /api/account/provisioning-requests` with body
   `{ "requestType": "workspace_and_claude" }`.
4. Server enforces the Claude-requires-League-email rule at the service
   layer, independent of UI state.
5. Server creates two ProvisioningRequests (type=workspace, type=claude),
   both status=pending.
6. AuditEvents recorded for each.
7. Services section shows "Pending" for both.

**Constraint enforcement:**
A raw API call with requestType=claude (workspace not yet pending/active)
must return 422 with an explanatory message. The enforcement lives in
ProvisioningRequestService, not in the route handler.

**Postconditions:**
- Two ProvisioningRequest records in status=pending.
- AuditEvents recorded.

**Acceptance Criteria:**
- [ ] POST with requestType=workspace_and_claude creates two pending
      ProvisioningRequests.
- [ ] POST with requestType=claude fails with 422 when no pending/active
      workspace account or workspace request exists.
- [ ] The constraint is enforced at the service layer (integration test
      bypasses the route).
- [ ] Services section shows "Pending" for both League Email and Claude Seat.

**Out of scope:**
- Administrator review and approval (Sprint 004).
- Actual Claude seat provisioning (Sprint 005).

---

## Out of Scope for Sprint 003

| Item | Sprint |
|---|---|
| Administrator review and approval of ProvisioningRequests | Sprint 004+ |
| Actual League Workspace account provisioning (Google Admin SDK) | Sprint 004 |
| Actual Claude Team seat provisioning (Claude Team API) | Sprint 005 |
| Pike13 write-back of GitHub handle on Login add | Sprint 006 |
| Merge suggestion triggering on Login add | Sprint 007 |
| Administrator-facing user directory | Sprint 009 |
| Staff directory view (/staff page content) | Sprint 009 |
| Editing profile fields (display name, primary email) | Not scheduled |
| Pike13 link from student account page | Not in spec |
