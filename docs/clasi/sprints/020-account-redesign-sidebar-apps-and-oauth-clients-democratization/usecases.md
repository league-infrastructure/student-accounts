---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 020 Use Cases

## SUC-020-001: User manages identity on /account

- **Actor**: Any authenticated user (student, staff, admin)
- **Preconditions**: User signed in.
- **Main Flow**:
  1. User opens `/account`.
  2. Page shows: profile (display name, email, role/cohort), linked logins table, Add buttons for Google/GitHub/Pike 13, and (if applicable) a username + password edit section.
  3. User edits display name → saves via existing `PATCH /api/account/profile`.
  4. User clicks Add Pike 13 → linked accounts updated after the OAuth round-trip.
  5. User with passphrase credentials opens the Username/Password section, edits username (uniqueness checked) and changes password (`PATCH /api/account/credentials`).
- **Postconditions**: Identity-only page; no sub-app launcher; no service status; no LLM proxy controls.
- **Acceptance Criteria**:
  - [ ] No tile grid present.
  - [ ] All three Add-Login buttons visible regardless of which providers are already linked.
  - [ ] Username/Password section hidden if user has neither.

## SUC-020-002: User opens a sub-app from the sidebar

- **Actor**: Any authenticated user
- **Preconditions**: User signed in.
- **Main Flow**:
  1. Sidebar lists role-appropriate items: always Account, Services, OAuth Clients; staff/admin add Staff Directory + User Management; admin adds Cohorts + Groups.
  2. User clicks a sidebar item → navigates to the corresponding page under `AppLayout`.
- **Postconditions**: Sub-apps reachable via sidebar without going through `/account`.
- **Acceptance Criteria**:
  - [ ] OAuth Clients sidebar item appears for every role.
  - [ ] Cohorts/Groups items appear for admin only.
  - [ ] Visiting `/admin/oauth-clients` redirects to `/oauth-clients`.

## SUC-020-003: Non-admin user registers an OAuth client

- **Actor**: Student or staff
- **Preconditions**: Signed in.
- **Main Flow**:
  1. User opens `/oauth-clients` from the sidebar.
  2. Lists their own clients (server filters by `created_by`).
  3. Clicks New, fills name + description + redirect URIs (multi-line) + scopes (checkbox group: `profile`, `users:read`).
  4. Server creates the client with `created_by = userId`, returns plaintext secret once.
  5. User copies the secret from the modal.
- **Postconditions**: User has a working OAuth client; their session can list it; another user's session cannot see or mutate it.
- **Acceptance Criteria**:
  - [ ] List endpoint returns only the caller's clients for non-admins.
  - [ ] Mutation of another user's client returns 403.
  - [ ] Admin still sees and manages all clients.

## SUC-020-004: Services sidebar page consolidates external-account UI

- **Actor**: Any authenticated user
- **Preconditions**: Signed in. May or may not have provisioned external services.
- **Main Flow**:
  1. User clicks Services in the sidebar → `/services`.
  2. Page renders the applicable sections: Workspace status (and one-time temp password if just created), Claude seat / Claude Code instructions if user has Claude access, LLM Proxy management if user has a token (or can request one).
  3. If nothing applies, an empty state message is shown.
- **Postconditions**: Account page is no longer cluttered with these zones.
- **Acceptance Criteria**:
  - [ ] Workspace temp password still surfaces here on first view (matching previous Account behaviour).
  - [ ] LLM Proxy management UI is reachable for the same set of users who saw it on Account before.
  - [ ] Friendly empty state when none of the sections apply.
