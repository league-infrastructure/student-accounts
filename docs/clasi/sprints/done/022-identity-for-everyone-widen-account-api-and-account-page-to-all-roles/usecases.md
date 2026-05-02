---
sprint: "022"
status: draft
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 022: Identity for Everyone

## SUC-022-001 — Staff or admin user views the Account page

**Actor:** Authenticated user with role `staff` or `admin`

**Precondition:** User is signed in; navigates to `/account`.

**Main Flow:**
1. The browser fetches `GET /api/account`.
2. The server verifies the session is authenticated. Because the endpoint no
   longer requires `requireRole('student')`, the request succeeds for all
   roles.
3. The server returns the standard Account response: `profile`, `logins`,
   `externalAccounts`. Fields relevant only to students (`cohort`,
   `workspaceTempPassword`, `llmProxyEnabled`) are null / false / empty for
   non-students.
4. The client receives a 200 response and populates the Account page.
5. The page renders `ProfileSection`, `LoginsSection` (with all three Add
   buttons), and `UsernamePasswordSection` (if credentials are set).
6. `WorkspaceSection` evaluates its own internal nullcheck: a non-student
   who has no workspace `ExternalAccount` and no League-format primary email
   sees nothing from that section. No explicit role gate is needed in this
   sprint.

**Outcome:** The staff or admin user sees their own identity information —
name, email, role badge, linked logins, Add-Login buttons — without being
blocked or shown a sparse empty page.

**Previously failing behavior:** `GET /api/account` returned 403 for
non-students; the client suppressed the identity sections via
`{isStudent && data && (...)}`. Staff and admin saw only `HelpSection`.

---

## SUC-022-002 — Staff or admin user links an additional login provider

**Actor:** Authenticated user with role `staff` or `admin`

**Precondition:** User is on `/account`; `LoginsSection` is rendered
(enabled by SUC-022-001). The provider to be added is configured in the
application environment.

**Main Flow:**
1. User clicks one of the three Add-Login buttons:
   - **Add Google** — visible when `providerStatus.google` is true.
   - **Add GitHub** — visible when `providerStatus.github` is true.
   - **Add Pike 13** — always visible.
2. The browser follows the `/api/auth/{provider}?link=1` link, initiating
   the OAuth link flow.
3. The provider authenticates the user and redirects back to the callback.
4. The server attaches the new login to the existing session user and
   redirects to `/account`.
5. The Account page re-fetches; the newly linked login appears in the
   `LoginsSection` table.

**Outcome:** Staff and admin can link Google, GitHub, and Pike 13 exactly as
students can. All three buttons are available to all roles.

**Stakeholder clarification (2026-05-01):** All three Add-Login buttons
(Google, GitHub, Pike 13) are wanted for staff and admin — not a subset.

---

## SUC-022-003 — Student views the Account page (regression guard)

**Actor:** Authenticated user with role `student`

**Precondition:** User is signed in; navigates to `/account`.

**Main Flow:**
1. The browser fetches `GET /api/account`.
2. The server returns the full student response including `cohort`,
   `workspaceTempPassword` (if applicable), and `llmProxyEnabled`.
3. All identity sections render as before (ProfileSection, LoginsSection,
   UsernamePasswordSection if credentials exist, WorkspaceSection if
   applicable).

**Outcome:** The student experience is unchanged from sprint 021. This use
case is a regression guard ensuring the server widening and client gate
removal do not degrade the student path.

---

## SUC-022-004 — AppLayout renders correctly across the loading-to-resolved auth transition

**Actor:** Any authenticated user opening the application.

**Precondition:** Browser opens the app; `AuthContext` initialises with
`loading: true`.

**Main Flow:**
1. `AppLayout` mounts. `useAuth()` returns `{ loading: true, user: null }`.
2. `AppLayout` renders the loading spinner and returns early.
3. Auth resolves: `useAuth()` updates to `{ loading: false, user: {...} }`.
4. `AppLayout` re-renders; `useQuery(['account'])` becomes enabled and fires.
5. The sidebar and content area render correctly. No blank page, no hook
   order violation, no React warning.

**Outcome:** The hook-order fix from sprint 021 (moving `useQuery` above the
conditional early return in `AppLayout`) is covered by a regression test that
traverses the `loading → resolved` transition — a path the prior test suite
never exercised, because mocks always returned `loading: false` immediately.

**Source:** Backlog item E (sprint 021 polish punch-list).
