---
sprint: '002'
status: approved
design-use-cases:
- UC-001
- UC-002
- UC-003
---

# Sprint 002 Use Cases

## SUC-001: Google OAuth Sign-In — New User Path

**Design reference:** UC-001

**Actor:** Prospective student (unauthenticated)

**Preconditions:**
- No User or Login record exists for this Google identity.
- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are configured.
- Google OAuth is reachable.

**Main Flow:**
1. Actor navigates to the app and selects "Sign in with Google."
2. App redirects to Google OAuth consent screen.
3. Actor authenticates and grants consent.
4. Google delivers the callback with `profile` (id, displayName, emails).
5. App queries `LoginRepository.findByProvider('google', profile.id)`.
6. No match found. App calls `UserService.createWithAudit` with
   `display_name`, `primary_email` from the Google profile, `role=student`,
   `created_via=social_login` — inside a transaction that also records a
   `create_user` AuditEvent.
7. App calls `LoginService.create` with `provider=google`, `provider_user_id`,
   `provider_email` — inside a transaction that records an `add_login` AuditEvent.
8. App calls `mergeScan(user)` — no-op stub that logs
   "merge-scan deferred to Sprint 007" and returns immediately. Call site is
   wired here so Sprint 007 can replace it with the real implementation.
9. App writes `{ userId, role: 'student' }` to `req.session`.
10. App redirects to student account page (stub — `GET /account` returns HTTP 200
    with placeholder text; full UI is Sprint 003).

**Existing User path (Duplicate Login found):**
If step 5 finds a Login match, the app skips steps 6–8 and proceeds directly
to step 9 using the existing User.

**Error flows:**
- Google OAuth fails or actor denies consent: redirect to sign-in page with
  error message; no User or Login created.
- Admin SDK is not called for non-`@jointheleague.org` accounts.

**Postconditions:**
- New User record exists with one Google Login attached.
- `req.session` contains `{ userId, role }`.
- AuditEvents recorded for `create_user` and `add_login`.

**Acceptance Criteria:**
- [ ] `GET /api/auth/google` initiates the OAuth redirect.
- [ ] On successful callback with a new identity, User and Login records are
      created atomically with AuditEvents.
- [ ] `req.session.userId` and `req.session.role` are set after sign-in.
- [ ] On callback with an existing identity, no new records are created; session
      is established for the existing User.
- [ ] OAuth deny/error returns to sign-in page with an error query param.
- [ ] `mergeScan` is called after new User creation and logs the deferral message.

---

## SUC-002: GitHub OAuth Sign-In — New User Path

**Design reference:** UC-002

**Actor:** Prospective student (unauthenticated)

**Preconditions:**
- No User or Login record exists for this GitHub identity.
- `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are configured.

**Main Flow:**
1. Actor selects "Sign in with GitHub."
2. App redirects to GitHub OAuth consent screen.
3. Actor authenticates and grants consent.
4. GitHub delivers the callback with `profile` (id, username, emails).
5. App queries `LoginRepository.findByProvider('github', profile.id)`.
6. No match found. App calls `UserService.createWithAudit` with
   `display_name` from GitHub profile username, `primary_email` from GitHub
   profile (or fallback to `<username>@github.invalid` if no public email),
   `role=student`, `created_via=social_login`.
7. App calls `LoginService.create` with `provider=github`, `provider_user_id`,
   `provider_email` (GitHub email or null), and the GitHub `username` stored in
   a `provider_username` field (see Architecture note below).
8. App calls `mergeScan(user)` — same no-op stub as SUC-001.
9. App writes `{ userId, role: 'student' }` to `req.session`.
10. App redirects to student account page stub.

**Existing User path:** Same as SUC-001 step 5 matched — sign into existing User.

**Error flows:**
- GitHub OAuth fails or actor denies consent: redirect to sign-in page with error.
- GitHub does not return a public email: `primary_email` falls back to
  `<github_username>@github.invalid`; this is stored and clearly marked as a
  placeholder. Administrator can update it later.

**Postconditions:**
- New User record exists with one GitHub Login attached.
- GitHub username is accessible on the Login record for future Pike13 write-back.
- AuditEvents recorded for `create_user` and `add_login`.

**Acceptance Criteria:**
- [ ] `GET /api/auth/github` initiates the OAuth redirect.
- [ ] On successful callback with a new identity, User and Login are created
      with audit trail.
- [ ] GitHub username is stored on the Login record in a queryable field.
- [ ] No public email from GitHub is handled gracefully (placeholder primary_email).
- [ ] `mergeScan` is called and logs the deferral message.
- [ ] Session established; redirect to account page stub.

---

## SUC-003: Staff Sign-In via League Staff OU

**Design reference:** UC-003

**Actor:** League staff member with a `@jointheleague.org` Google Workspace account

**Preconditions:**
- Actor has a `@jointheleague.org` Google Workspace account in the League staff OU.
- `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` are configured.
- `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_ADMIN_DELEGATED_USER_EMAIL` are
  configured (for Admin SDK domain-wide delegation).
- `GOOGLE_STAFF_OU_PATH` is set to the staff OU root path (e.g.,
  `/League Staff`).

**Main Flow:**
1. Actor selects "Sign in with Google."
2. Google OAuth callback returns profile with `@jointheleague.org` email.
3. App detects the domain is `@jointheleague.org` (not `@students.jointheleague.org`
   or other).
4. App calls `LoginRepository.findByProvider('google', profile.id)`.
5. If no match: app calls `UserService.createWithAudit` with `role=student`
   as default (role is updated in step 7 after OU confirmation).
   If match: retrieve existing User.
6. App calls `GoogleAdminDirectoryClient.getUserOU(email)` — returns the actor's
   full OU path from the Google Admin Directory API.
7. If OU path starts with `GOOGLE_STAFF_OU_PATH`: set `user.role = 'staff'`
   (update User record if it was just created as student, or confirm existing role).
8. App writes `{ userId, role: 'staff' }` to `req.session`.
9. App redirects to staff directory view (stub — `GET /staff` returns HTTP 200
    with placeholder text; full UI is Sprint 003).

**Domain routing logic:**
- `@jointheleague.org` → call Admin SDK OU check (steps 3–7).
- `@students.jointheleague.org` → skip OU check; treat as student.
- Any other domain → skip OU check; treat as student.

**Error flows:**
- Admin SDK call fails: access is denied; error page returned; session not
  established. Failure to confirm staff status must not grant access.
- Actor is `@jointheleague.org` but not in the staff OU: `role` remains `student`;
  session established as student; redirect to student page.

**Postconditions:**
- Staff User has exactly one Login (their League Google account).
- Session carries `role: 'staff'`.
- No External Accounts associated with the staff User.
- Staff sees staff directory stub.

**Acceptance Criteria:**
- [ ] `@jointheleague.org` accounts trigger the Admin SDK OU lookup.
- [ ] `@students.jointheleague.org` accounts skip the OU lookup and are treated
      as students.
- [ ] OU lookup result sets `role=staff` when within `GOOGLE_STAFF_OU_PATH`.
- [ ] Admin SDK failure results in access denied (not a silent student login).
- [ ] Staff session redirects to staff directory stub.
- [ ] `GoogleAdminDirectoryClient` is dependency-injected so tests can supply
      a fake implementation without a real service account.

---

## Scope Boundary

### In Sprint 002

| Capability | SUC |
|---|---|
| Google OAuth sign-in, new and returning user | SUC-001 |
| GitHub OAuth sign-in, new and returning user | SUC-002 |
| Staff OU detection via Google Admin SDK | SUC-003 |
| Session establishment (`userId`, `role`) | SUC-001/002/003 |
| Logout route and session cleanup | infrastructure |
| Auth middleware (`requireAuth`, `requireRole`) | infrastructure |
| Merge-scan call site (no-op stub) | SUC-001/002 |
| Audit events: `create_user`, `add_login` | SUC-001/002/003 |
| Integration tests for all OAuth flows | infrastructure |

### Out of Sprint 002

| Capability | Sprint |
|---|---|
| Student account page content | Sprint 003 |
| Staff directory page content | Sprint 003 |
| Adding/removing Logins from account page | Sprint 003 |
| Admin login management UI | Sprint 005 |
| Real merge-scan implementation | Sprint 007 |
| Pike13 sync and GitHub username write-back | Sprint 006 |
| Cohort management and Workspace provisioning | Sprint 004 |
| Provisioning requests UI | Sprint 004 |
