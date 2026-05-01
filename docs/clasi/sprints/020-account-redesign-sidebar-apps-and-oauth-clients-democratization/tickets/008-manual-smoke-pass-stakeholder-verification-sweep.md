---
id: "008"
title: "Manual smoke pass stakeholder verification sweep"
status: todo
use-cases:
  - SUC-020-001
  - SUC-020-002
  - SUC-020-003
  - SUC-020-004
depends-on:
  - "001"
  - "002"
  - "003"
  - "004"
  - "005"
  - "006"
  - "007"
github-issue: ""
todo: "plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke pass stakeholder verification sweep

## Description

End-to-end manual verification of Sprint 020 against the dev
deployment. **This ticket is owned by the stakeholder; the
implementing agent leaves it in `todo` status — do NOT mark it
done.** It exists so the sprint cannot close without an explicit
human pass.

The checklist mirrors the success criteria in `sprint.md` (lines
62-78) and the four use cases in `usecases.md`.

### Identity (SUC-020-001)

- [ ] `/account` shows: profile (display name, email, role/cohort badge), linked logins table, and three Add buttons: Google, GitHub, Pike 13. Nothing else (no tile grid, no Services zone, no Claude zone, no LLM proxy controls).
- [ ] All three Add buttons are visible regardless of which providers are already linked.
- [ ] `UsernamePasswordSection` appears for a passphrase-credentialed user; does NOT appear for a user with neither username nor password.
- [ ] Editing username to a free value succeeds; editing to an existing other-user's username surfaces "Username already taken" inline.
- [ ] Changing password with the wrong current password surfaces "Current password is incorrect" inline; the password is not changed.
- [ ] Changing password with the right current password works; user can log out and log back in with the new password.
- [ ] Add Pike 13 button initiates the Pike13 OAuth round trip and the user lands back on `/account` with Pike13 listed in the linked-logins table.

### Sidebar navigation (SUC-020-002)

- [ ] As a student: sidebar shows Account, Services, OAuth Clients only.
- [ ] As staff: above plus Staff Directory and User Management.
- [ ] As admin: above plus Cohorts and Groups.
- [ ] OAuth Clients is reachable from the sidebar by every role.
- [ ] Visiting `/admin/oauth-clients` redirects to `/oauth-clients`.
- [ ] Sidebar items remain visible while inside an `/admin/*` route (i.e. the old `!isAdminSection` hide is gone).

### OAuth Clients (SUC-020-003)

- [ ] Non-admin opens `/oauth-clients`, list shows only their own clients (seed two clients, one owned, one not, and verify only the owned one appears).
- [ ] Non-admin can create a new client; secret modal appears once with the plaintext secret.
- [ ] Non-admin attempting `PATCH/DELETE` on another user's client (via curl/devtools) returns 403.
- [ ] Admin opens `/oauth-clients` and sees ALL clients across users.
- [ ] The scope picker is two checkboxes labeled `profile` and `users:read` — no free-text input.
- [ ] `curl /api/admin/oauth-clients` (with valid session cookie) returns a 308 redirect to `/api/oauth-clients`; following the redirect succeeds.

### Services (SUC-020-004)

- [ ] `/services` page renders Workspace status, Claude Code, and LLM Proxy zones for a user entitled to all three.
- [ ] User without any entitlements sees the friendly empty state.
- [ ] First-view Workspace temp-password surfaces on `/services` for a freshly-provisioned user (matches pre-Sprint-020 Account behaviour).

### Test suite baseline

- [ ] `npm run test:server` returns to ~1620 passing (modulo the documented SQLite-ordering flake).
- [ ] `npm run test:client` holds the ~203 + 35-pre-existing-failures baseline.

## Acceptance Criteria

- [ ] All checklist items above verified by the stakeholder against the dev deployment.
- [ ] Any failures filed as follow-up TODOs in `docs/clasi/todo/`.
- [ ] Stakeholder signs off in this ticket's body (timestamp + name) before sprint close.

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client` (one final run before sign-off).
- **New tests to write**: None — manual ticket.
- **Verification command**: Manual checklist above.
