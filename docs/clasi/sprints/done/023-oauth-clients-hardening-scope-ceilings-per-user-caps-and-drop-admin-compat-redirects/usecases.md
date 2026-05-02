---
sprint: "023"
status: draft
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 023: OAuth Clients Hardening

## SUC-023-001: Student is limited to one OAuth client

**Actor:** Student
**Goal:** Register a personal OAuth client for their project
**Policy:** Students may have at most one active (non-disabled) OAuth client.

**Main Flow:**
1. Student navigates to `/oauth-clients`.
2. Student clicks "+ New OAuth Client" and submits the create form.
3. Server counts existing non-disabled clients owned by the student — zero found.
4. Client is created; the plaintext secret is shown once.

**Alternative — at cap:**
1. Student navigates to `/oauth-clients`; the page shows their one existing client.
2. The create button and form are absent; a message explains the one-client limit.
3. Any API attempt to create a second client (bypassing the UI) returns 403.

**Acceptance Criteria:**
- [ ] A student with zero clients can successfully create one.
- [ ] A student with one client cannot create a second (API returns 403; UI suppresses the form).
- [ ] Disabled clients do not count toward the cap.
- [ ] A cap-rejected create attempt is recorded in the audit log.

---

## SUC-023-002: Staff and admin have no client cap

**Actor:** Staff member or admin
**Goal:** Register multiple OAuth clients as needed

**Main Flow:**
1. Actor navigates to `/oauth-clients`.
2. Actor can see the "+ New OAuth Client" button regardless of how many clients they already own.
3. Actor creates a second, third, or Nth client — each succeeds without a cap error.

**Acceptance Criteria:**
- [ ] A staff user with N existing clients (N >= 1) can always create another.
- [ ] An admin user with N existing clients (N >= 1) can always create another.
- [ ] The cap check in `OAuthClientService.create` is bypassed entirely for staff and admin (not a high ceiling).

---

## SUC-023-003: Students are restricted to the `profile` scope

**Actor:** Student
**Goal:** Register an OAuth client requesting scopes
**Policy:** Students may request only the `profile` scope.

**Main Flow:**
1. Student opens the create form.
2. The scope checkboxes show only `profile`; `users:read` is not rendered.
3. Student submits the form with `allowed_scopes: ['profile']` — succeeds.

**Alternative — scope escalation attempt:**
1. Student submits a crafted POST body with `allowed_scopes: ['users:read']`.
2. Server rejects with 403 and an error message describing the scope restriction.

**Acceptance Criteria:**
- [ ] Student create/update with `['profile']` succeeds.
- [ ] Student create/update with `['users:read']` or `['profile', 'users:read']` returns 403.
- [ ] The `OAuthClients` page renders no `users:read` checkbox for students.
- [ ] The scope-ceilings TODO comment is removed from `OAuthClients.tsx`.

---

## SUC-023-004: Staff and admin may request any scope

**Actor:** Staff member or admin
**Goal:** Register an OAuth client with any supported scope
**Policy:** Staff and admin have no scope ceiling.

**Main Flow:**
1. Actor opens the create form; all scope checkboxes (`profile`, `users:read`) are shown.
2. Actor selects `users:read` and submits — client is created successfully.
3. Actor updates an existing client to add or remove any scope — update succeeds.

**Acceptance Criteria:**
- [ ] Staff create with `['profile', 'users:read']` succeeds.
- [ ] Admin create with `['profile', 'users:read']` succeeds.
- [ ] Staff/admin update that changes `allowed_scopes` to any valid value succeeds.
- [ ] Both scope checkboxes are visible in the client UI for staff and admin.

---

## SUC-023-005: Admin shared pool — any admin can mutate any admin's client

**Actor:** Admin A
**Goal:** Manage another admin's (Admin B's) OAuth client
**Policy:** Admins operate a collective pool; ownership filter does not apply between admins.

**Main Flow:**
1. Admin B creates an OAuth client.
2. Admin A logs in and views the OAuth Clients list — Admin B's client appears.
3. Admin A edits the name/description of Admin B's client — update succeeds.
4. Admin A rotates the secret of Admin B's client — rotation succeeds.
5. Admin A disables Admin B's client — disable succeeds.

**Acceptance Criteria:**
- [ ] `list({ actorRole: 'admin' })` returns all admin-owned clients regardless of `created_by`.
- [ ] `update`, `rotateSecret`, `disable` succeed when actor is admin and target is owned by a different admin.
- [ ] `enforceOwnership` permits admin-on-any-admin-client operations (regression tests added).
- [ ] A non-admin cannot access another user's client — 403 on any mutation attempt.

---

## SUC-023-006: Compat redirect paths return not-found

**Actor:** Any caller (browser or HTTP client)
**Goal:** Access the old admin OAuth client paths after compat removal

**Scenarios:**
- `GET /api/admin/oauth-clients` (HTTP) returns 404 — compat router deleted.
- `GET /admin/oauth-clients` (browser) renders the NotFound page — `<Navigate>` route deleted.

**Acceptance Criteria:**
- [ ] No `oauthClientsCompatRouter` mount in `server/src/app.ts`.
- [ ] No `oauthClientsCompatRouter` export in `server/src/routes/oauth-clients.ts`.
- [ ] No `<Navigate to="/oauth-clients" />` route in `client/src/App.tsx`.
- [ ] An HTTP GET to `/api/admin/oauth-clients` on a running server returns 404.
- [ ] No redirect-related tests remain in `tests/server/routes/oauth-clients.test.ts`.
