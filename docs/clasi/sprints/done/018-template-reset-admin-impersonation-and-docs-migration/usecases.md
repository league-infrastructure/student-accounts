---
sprint: "018"
status: draft
---
<!-- Social-login use cases SUC-008 through SUC-012 added as part of sprint addendum -->
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 018

## SUC-001: Demo Login as Regular User

- **Actor:** Unauthenticated visitor
- **Preconditions:** App is running; user is not logged in.
- **Main Flow:**
  1. User navigates to `/login`.
  2. Form is displayed pre-filled with `user` / `pass`.
  3. User submits the form (credentials accepted as-is or changed).
  4. Server validates credentials against hardcoded pairs; matches `user`/`pass` → USER role.
  5. Server finds-or-creates `User { email: "user@demo.local", role: USER }` and establishes session.
  6. User is redirected to `/` and sees the counter UI.
  - **Alternate (bad credentials):** User submits unknown credentials → 401 → form shows error; no redirect.
- **Postconditions:** Session established; `req.user` is the demo user; role badge shows USER.
- **Acceptance Criteria:**
  - [ ] `/login` shows a form with username and password inputs pre-filled with `user` / `pass`
  - [ ] Valid `user`/`pass` redirects to `/` and shows counter UI
  - [ ] Invalid credentials return an error message on the form (no redirect)
  - [ ] No OAuth button or Pike13 link is present on the login page

---

## SUC-002: Demo Login as Admin User

- **Actor:** Unauthenticated visitor
- **Preconditions:** App is running; user is not logged in.
- **Main Flow:**
  1. User navigates to `/login`, enters `admin` / `admin`, and submits.
  2. Server matches `admin`/`admin` → ADMIN role; finds-or-creates `User { email: "admin@demo.local", role: ADMIN }`.
  3. User is redirected to `/` and sees the counter UI with Admin and Configuration links in the sidebar.
- **Postconditions:** Session established; `req.user.role === ADMIN`; admin sidebar links visible.
- **Acceptance Criteria:**
  - [ ] `admin`/`admin` login succeeds and creates/finds admin@demo.local
  - [ ] Sidebar shows Configuration (→ /admin/config) and Admin links only for ADMIN role
  - [ ] USER role login does not show Configuration or Admin links

---

## SUC-003: Increment Named Counter

- **Actor:** Authenticated user (any role)
- **Preconditions:** User is logged in; counters `alpha` and `beta` exist in the database (seeded).
- **Main Flow:**
  1. User is on the home page `/`.
  2. Both counter names and their current values are displayed.
  3. User clicks the button for one counter (e.g., `alpha`).
  4. Client POSTs to `/api/counters/alpha/increment`.
  5. Server increments `Counter.value` for `alpha` and returns the new value.
  6. Client updates the displayed value; `beta` counter is unchanged.
  7. User reloads the page; both counters show the persisted values.
- **Postconditions:** `Counter.value` for the clicked counter is incremented by 1 and persisted.
- **Acceptance Criteria:**
  - [ ] Home page displays `alpha` and `beta` counters with their current values
  - [ ] Clicking the `alpha` button increments only `alpha`; `beta` is unchanged
  - [ ] Clicking the `beta` button increments only `beta`; `alpha` is unchanged
  - [ ] Values persist across page reload (stored in database, not in-memory)
  - [ ] Counter row is auto-created on first increment if missing (upsert behavior)

---

## SUC-004: Admin Impersonates a User

- **Actor:** Authenticated admin
- **Preconditions:** Admin is logged in; at least one other user exists in the database.
- **Main Flow:**
  1. Admin navigates to Admin > Users.
  2. Each user row has an "Impersonate" button (button absent on own row).
  3. Admin clicks "Impersonate" on a target user.
  4. Client POSTs to `/api/admin/users/:id/impersonate`.
  5. Server validates target exists and prevents self-impersonation; sets `req.session.impersonatingUserId` and `realAdminId`.
  6. Page reloads; app presents as the target user (role badge, nav links, data scope).
  7. A colored impersonation banner is visible (e.g., "Viewing as: {displayName}").
  8. Account dropdown shows "Stop impersonating" instead of "Log out".
- **Postconditions:** Session carries impersonation state; `req.user` is the target user; `req.realAdmin` is the original admin.
- **Acceptance Criteria:**
  - [ ] "Impersonate" button appears in each user row except the admin's own row
  - [ ] Clicking Impersonate sets session state and reloads page as target user
  - [ ] Role badge and nav links reflect the target user's role
  - [ ] Impersonation banner is visible with target user's display name
  - [ ] Account dropdown shows "Stop impersonating" (not "Log out") during impersonation
  - [ ] Attempting to impersonate self returns an error

---

## SUC-005: Admin Stops Impersonating

- **Actor:** Admin currently impersonating another user
- **Preconditions:** Active impersonation session exists.
- **Main Flow:**
  1. Admin clicks "Stop impersonating" in the account dropdown.
  2. Client POSTs to `/api/admin/stop-impersonating`.
  3. Server clears `impersonatingUserId` and `realAdminId` from the session.
  4. Page reloads; app presents as the admin's own identity.
  5. Impersonation banner disappears; "Log out" reappears in the dropdown.
- **Postconditions:** Impersonation fields absent from session; `req.user` is the real admin again.
- **Acceptance Criteria:**
  - [ ] "Stop impersonating" button in account dropdown triggers endpoint and reloads
  - [ ] After stopping, identity is fully restored to the real admin
  - [ ] Impersonation banner is no longer visible
  - [ ] Normal "Log out" appears in dropdown again

---

## SUC-006: Admin Accesses Admin Routes During Impersonation

- **Actor:** Admin currently impersonating a non-admin user
- **Preconditions:** Admin is impersonating a USER-role account.
- **Main Flow:**
  1. Admin navigates to `/admin/*`.
  2. `requireAdmin` detects `req.realAdmin` and checks the real admin's role (ADMIN).
  3. Access is granted; the admin panel loads normally.
  4. The impersonation banner remains visible throughout.
- **Postconditions:** Admin panel accessible; impersonation state preserved.
- **Acceptance Criteria:**
  - [ ] Admin can navigate to `/admin/*` while impersonating a non-admin user
  - [ ] `requireAdmin` uses `req.realAdmin.role` when `req.realAdmin` is set
  - [ ] Non-admin users cannot access admin routes directly (unaffected by this sprint)

---

## SUC-007: Docs Auto-Loaded as Agent Rules

- **Actor:** AI agent starting a new session
- **Preconditions:** Sprint 018 docs migration is complete.
- **Main Flow:**
  1. Agent starts a session in the project.
  2. Rules system auto-loads `api-integrations.md`, `deployment.md`, `secrets.md`,
     `setup.md`, `template-spec.md` from `.claude/rules/` based on `paths:` front matter.
  3. Agent can reference OAuth setup, deployment steps, secrets inventory, dev server
     setup, and architecture conventions without manual file lookup.
- **Postconditions:** All five rule files present in `.claude/rules/`; originals absent from `docs/`.
- **Acceptance Criteria:**
  - [ ] All five files exist in `.claude/rules/` with valid YAML `paths:` front matter
  - [ ] Originals no longer exist under `docs/` (api-integrations, deployment, secrets, setup, template-spec)
  - [ ] CLAUDE.md Documentation table updated — stale `docs/` links removed or replaced
  - [ ] No other file in the repo references the old `docs/` paths for migrated files

---

## SUC-008: OAuth Login via GitHub

- **Actor:** Unauthenticated visitor (or demo-form user returning to link an account)
- **Preconditions:** `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set in the environment.
- **Main Flow:**
  1. User visits `/login` and sees "Sign in with GitHub" below the demo form.
  2. User clicks the button; browser navigates to `/api/auth/github`.
  3. Server redirects to GitHub OAuth consent page.
  4. User grants consent; GitHub redirects to `/api/auth/github/callback` with `code`.
  5. Server exchanges code for token, stores token in session, fetches GitHub profile.
  6. Server runs find-or-create: looks up `(provider='github', providerId)`; if no match, falls back to email auto-link; if still no match, creates a new user + `UserProvider` row.
  7. Session is established; user is redirected to `/`.
  - **Alternate (new email):** New user and `UserProvider` row created; user lands on `/`.
  - **Alternate (email matches existing user):** `UserProvider` row created on existing user; session established as that user.
- **Postconditions:** `UserProvider` row exists for `(userId, provider='github', providerId)`; user is logged in.
- **Acceptance Criteria:**
  - [ ] GitHub button visible on `/login` when `GITHUB_CLIENT_ID`/`_SECRET` set; hidden when not set
  - [ ] Completing GitHub OAuth establishes session and redirects to `/`
  - [ ] First-time login with new email creates `User` + `UserProvider` row
  - [ ] Login with email matching existing user creates only a `UserProvider` row (no new user)
  - [ ] Repeat login with same `(provider, providerId)` returns same user without creating rows

---

## SUC-009: OAuth Login via Google

- **Actor:** Unauthenticated visitor
- **Preconditions:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- **Main Flow:** Identical to SUC-008 but using Google OAuth and `GOOGLE_*` env vars.
- **Postconditions:** `UserProvider` row exists for `(userId, provider='google', providerId)`.
- **Acceptance Criteria:**
  - [ ] Google button visible on `/login` when `GOOGLE_CLIENT_ID`/`_SECRET` set; hidden otherwise
  - [ ] Completing Google OAuth establishes session and redirects to `/`
  - [ ] Find-or-create / email auto-link behavior identical to SUC-008

---

## SUC-010: OAuth Login via Pike 13

- **Actor:** Unauthenticated visitor
- **Preconditions:** `PIKE13_CLIENT_ID` and `PIKE13_CLIENT_SECRET` are set.
- **Main Flow:**
  1. User sees "Sign in with Pike 13" on `/login`.
  2. Clicking navigates to `/api/auth/pike13`; server redirects to Pike 13 authorization URL.
  3. User grants consent; Pike 13 redirects to `/api/auth/pike13/callback` with `code`.
  4. Server exchanges code for token (hand-rolled, not Passport), fetches Pike 13 profile.
  5. Find-or-create logic runs identically to GitHub/Google.
  6. Session established; redirect to `/`.
- **Postconditions:** `UserProvider` row for `(userId, provider='pike13', providerId)`.
- **Acceptance Criteria:**
  - [ ] Pike 13 button visible on `/login` when env vars set; hidden otherwise
  - [ ] Completing Pike 13 OAuth establishes session and redirects to `/`
  - [ ] Token exchange and profile fetch succeed; error redirects to `/login` on failure

---

## SUC-011: Link Additional Provider from Account Page

- **Actor:** Authenticated user
- **Preconditions:** User is logged in; at least one configured OAuth provider is not yet linked.
- **Main Flow:**
  1. User visits `/account` and sees the "Sign-in methods" section.
  2. A configured-but-unlinked provider shows an "Add \<Provider\>" button.
  3. User clicks it; browser navigates to `/api/auth/<provider>?link=1`.
  4. User completes the OAuth consent flow.
  5. Callback detects link mode from `req.session.oauthLinkMode`; creates a `UserProvider`
     row binding the OAuth identity to the current user. No new user is created.
  6. User is redirected back to `/account`.
  7. The provider now appears in the linked-providers list.
  - **Alternate (identity already bound to another user):** Returns error; no data modified.
- **Postconditions:** New `UserProvider` row for the current user; primary `User` row unchanged.
- **Acceptance Criteria:**
  - [ ] "Add \<Provider\>" button appears for configured-but-unlinked providers on Account page
  - [ ] Completing the OAuth flow in link mode creates a `UserProvider` row on the current user
  - [ ] No new `User` row is created in link mode
  - [ ] On return to Account page, the newly linked provider appears in the list
  - [ ] Attempting to link an identity already bound to a different user returns a clear error

---

## SUC-012: Unlink Provider from Account Page

- **Actor:** Authenticated user with at least two login methods
- **Preconditions:** User has two or more linked providers / login methods.
- **Main Flow:**
  1. User visits `/account`; "Sign-in methods" section shows linked providers.
  2. User clicks "Unlink" on a provider.
  3. Client calls `POST /api/auth/unlink/:provider`.
  4. Server validates the guardrail (at least one method remains); deletes the `UserProvider`
     row; if the unlinked provider was the primary (`User.provider`), clears it to null.
  5. Client calls `refresh()` to reload user state from `/api/auth/me`.
  6. The unlinked provider disappears from the list.
  - **Alternate (only one method remains):** "Unlink" button is disabled client-side; if
    called via API anyway, server returns 400.
- **Postconditions:** `UserProvider` row deleted; `User.provider`/`User.providerId` cleared if applicable.
- **Acceptance Criteria:**
  - [ ] "Unlink" button disabled when user has only one remaining login method
  - [ ] Successful unlink removes the provider from the displayed list without page reload
  - [ ] Attempting unlink as last method via API returns 400
  - [ ] Unlinking the primary provider clears `User.provider` and `User.providerId` in the database
