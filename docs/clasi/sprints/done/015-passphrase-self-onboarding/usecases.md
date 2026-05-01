---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 015 Use Cases

## SUC-001: Admin Creates Passphrase
Parent: UC-Admin

- **Actor**: Admin (instructor or administrator)
- **Preconditions**: Admin is authenticated; the target Group or Cohort exists and has no active passphrase.
- **Main Flow**:
  1. Admin opens the Group or Cohort detail page.
  2. The passphrase card shows "Create passphrase" button.
  3. Admin clicks "Create passphrase"; `PassphraseModal` opens with a freshly generated three-word suggestion.
  4. Admin optionally edits the passphrase text or clicks "Regenerate" for a new suggestion.
  5. Admin optionally checks "Also grant an LLM proxy token when students sign up".
  6. Admin clicks "Create".
  7. Client POSTs to `POST /admin/cohorts/:id/passphrase` or `POST /admin/groups/:id/passphrase`.
  8. Server validates shape, checks collision with other active passphrases, persists the passphrase with a 1-hour TTL, writes a `create_signup_passphrase` audit event, and notifies the SSE bus.
  9. Modal closes; the passphrase card shows the plaintext, live TTL countdown, Copy/Regenerate/Revoke controls, and (if opted in) the LLM proxy indicator.
- **Postconditions**: The scope has one active passphrase. The audit log records who created it.
- **Acceptance Criteria**:
  - [ ] Modal pre-fills a valid three-word passphrase.
  - [ ] "Regenerate" produces a different valid passphrase.
  - [ ] Submitting saves the passphrase and the card appears with correct TTL.
  - [ ] `grantLlmProxy` flag is persisted and displayed.
  - [ ] Audit event `create_signup_passphrase` is written.
  - [ ] SSE `cohorts` or `groups` topic fires.

---

## SUC-002: Admin Rotates Passphrase
Parent: UC-Admin

- **Actor**: Admin
- **Preconditions**: Admin is authenticated; the scope has an active passphrase.
- **Main Flow**:
  1. Admin clicks "Regenerate" on the active passphrase card.
  2. A new modal pre-populates with a freshly generated passphrase (LLM proxy checkbox defaults to previous setting).
  3. Admin confirms; client POSTs to the same create endpoint.
  4. Server overwrites the previous passphrase (one active passphrase per scope); new TTL starts from now; audit event written.
  5. Card updates with new plaintext and reset TTL countdown.
- **Postconditions**: Old passphrase is gone; any students who had not yet signed up with the old one cannot use it.
- **Acceptance Criteria**:
  - [ ] Card shows updated passphrase text and fresh 60-minute TTL.
  - [ ] Previous passphrase is no longer accepted at `/api/auth/passphrase-signup`.
  - [ ] Audit event records the rotation.

---

## SUC-003: Admin Revokes Passphrase
Parent: UC-Admin

- **Actor**: Admin
- **Preconditions**: Admin is authenticated; the scope has an active passphrase.
- **Main Flow**:
  1. Admin clicks "Revoke" on the passphrase card.
  2. Client calls `DELETE /admin/cohorts/:id/passphrase` or `DELETE /admin/groups/:id/passphrase`.
  3. Server clears all five passphrase fields, writes a `revoke_signup_passphrase` audit event, and notifies the SSE bus.
  4. Card flips back to the "Create passphrase" empty state.
- **Postconditions**: No active passphrase on the scope; any in-flight signup attempts return 401.
- **Acceptance Criteria**:
  - [ ] Card returns to empty state immediately after revoke.
  - [ ] Subsequent signup attempts with the revoked passphrase return 401 "Invalid or expired passphrase".
  - [ ] Audit event `revoke_signup_passphrase` is written.

---

## SUC-004: Student Signs Up via Passphrase (Cohort Scope)
Parent: UC-Student

- **Actor**: Unauthenticated student
- **Preconditions**: A cohort has an active, non-expired passphrase.
- **Main Flow**:
  1. Student opens `/login` and expands the "New student? Sign up with a class passphrase" disclosure.
  2. Student enters their desired username and the class passphrase, then submits.
  3. Client POSTs to `POST /api/auth/passphrase-signup`.
  4. Server validates username shape, looks up the passphrase, checks it is not expired, checks username uniqueness.
  5. Server creates the `User` record (`role='student'`, `approval_status='approved'`, `is_active=true`, `onboarding_completed=true`) and a `Login` row with `provider='passphrase'`.
  6. Outside the main transaction (fail-soft): server provisions a Google Workspace account; if `grantLlmProxy` is true, mints a 30-day proxy token.
  7. Session is set; `adminBus.notify('users')` and `adminBus.notify('cohorts')` fire.
  8. Client receives 200 with partial-success payload; browser navigates to `/account`.
- **Postconditions**: Student has an active approved account, a workspace email, and (optionally) an LLM proxy token. They appear in the cohort's member list.
- **Acceptance Criteria**:
  - [ ] Student lands on `/account` with workspace account visible.
  - [ ] Student record has `cohort_id` set, `approval_status='approved'`, `is_active=true`.
  - [ ] Workspace provisioning failure returns 200 with `workspace.provisioned=false` (partial success).
  - [ ] LLM proxy token is minted when `grantLlmProxy=true`.
  - [ ] Session cookie is set; student is authenticated.

---

## SUC-005: Student Signs Up via Passphrase (Group Scope)
Parent: UC-Student

- **Actor**: Unauthenticated student
- **Preconditions**: A group has an active, non-expired passphrase.
- **Main Flow**:
  1. Same signup flow as SUC-004 steps 1–4.
  2. Server creates `User` with a synthetic `primary_email` (`<slug>.g<groupId>@signup.local`); `cohort_id` is null.
  3. Outside the main transaction (fail-soft): server calls `groupService.addMember(groupId, userId, actorId=userId)`; if `grantLlmProxy` is true, mints a proxy token.
  4. Session is set; browser navigates to `/account`.
- **Postconditions**: Student has an active approved account and is a member of the group. No workspace is provisioned.
- **Acceptance Criteria**:
  - [ ] Student lands on `/account`; no workspace account section shows.
  - [ ] Student appears in the group's member list.
  - [ ] `primary_email` is the synthetic `.g<id>@signup.local` address (never visible to student).
  - [ ] No workspace provisioning is attempted.

---

## SUC-006: Student Signs In with Username + Passphrase
Parent: UC-Student

- **Actor**: Previously signed-up student (via passphrase)
- **Preconditions**: Student has a `username` and `password_hash` on their user record.
- **Main Flow**:
  1. Student opens `/login`; the main form shows "Username" and "Passphrase" fields (passphrase is `type="text"` so it is visible).
  2. Student enters username and passphrase, submits.
  3. Client POSTs to `POST /api/auth/login`.
  4. Server looks up user by username, calls `verifyPassword(plain, hash)`, sets `req.session.userId`.
  5. Client receives 200; browser navigates to `/account`.
- **Postconditions**: Student session is established.
- **Acceptance Criteria**:
  - [ ] Login succeeds even after the original class passphrase has expired or been revoked.
  - [ ] Wrong passphrase returns 401 "Invalid username or password" (generic; no enumeration).
  - [ ] Missing username returns the same generic 401.
  - [ ] Session cookie is set; student is authenticated.

---

## SUC-007: Signup Rejected — Expired Passphrase
Parent: UC-Student

- **Actor**: Unauthenticated student
- **Preconditions**: A cohort or group passphrase has passed its 1-hour TTL (or been revoked).
- **Main Flow**:
  1. Student submits the signup form with a passphrase that is expired or revoked.
  2. Server's `PassphraseService.findBySignupValue` returns null (TTL expired or fields cleared).
  3. Server returns `401 { error: 'Invalid or expired passphrase' }`.
  4. Client shows inline error; student cannot proceed.
- **Postconditions**: No user record is created.
- **Acceptance Criteria**:
  - [ ] Expired passphrase returns 401 with the exact message.
  - [ ] Revoked passphrase returns 401 with the exact message.
  - [ ] No user record is created.

---

## SUC-008: Signup Rejected — Username Already Taken
Parent: UC-Student

- **Actor**: Unauthenticated student
- **Preconditions**: A valid, non-expired passphrase exists; the desired username is already taken by another user.
- **Main Flow**:
  1. Student submits the signup form with a username that already exists in `User.username`.
  2. Server pre-checks uniqueness before the transaction; returns `409 { error: 'That username is already taken' }`.
  3. Client shows inline error.
- **Postconditions**: No new user record is created; existing user is unaffected.
- **Acceptance Criteria**:
  - [ ] 409 is returned before any DB write.
  - [ ] Error message is exactly "That username is already taken".
  - [ ] Existing user record is not modified.
