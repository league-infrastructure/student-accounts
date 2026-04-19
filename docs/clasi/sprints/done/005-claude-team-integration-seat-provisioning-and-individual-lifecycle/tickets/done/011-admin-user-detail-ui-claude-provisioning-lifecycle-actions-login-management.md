---
id: "011"
title: "Admin user detail UI — Claude provisioning, lifecycle actions, login management"
status: done
use-cases: [SUC-001, SUC-002, SUC-003, SUC-004, SUC-005, SUC-006]
depends-on: ["007", "008", "009", "010"]
---

# Admin user detail UI — Claude provisioning, lifecycle actions, login management

## Description

Extend the admin user detail view (within `UsersPanel.tsx` or a new
`UserDetailPanel.tsx` component) to expose all the new Sprint 005 actions. All
new UI is within the existing admin user detail context — no new top-level React
routes.

**External Accounts section additions:**
- For each ExternalAccount row: "Suspend" button (if status=active), "Remove"
  button (if status=active or suspended), with confirmation dialogs.
- "Provision Claude Team Seat" button: shown for students; disabled with tooltip
  when no active workspace account exists or when a claude account already exists.
- "Deprovision Student" button: shown for student users; opens a confirmation
  dialog listing all accounts to be removed.

**Logins section additions:**
- "Add Login" button: opens a form to select provider (Google/GitHub) and enter
  provider_user_id and optional provider_email.
- "Remove" button on each Login row: shows a confirmation dialog; disabled when
  the user has only one Login.

All destructive actions require a confirmation dialog before the API call.

## Acceptance Criteria

- [x] "Suspend" button appears on active ExternalAccount rows; posts to /admin/external-accounts/:id/suspend.
- [x] "Remove" button appears on active/suspended ExternalAccount rows; posts to /admin/external-accounts/:id/remove.
- [x] Confirmation dialog shown before suspend and remove actions.
- [x] "Provision Claude Team Seat" button shown for student users.
- [x] Provision button is disabled (with tooltip explaining precondition) when workspace account is not active.
- [x] Provision button is disabled when claude account already exists.
- [x] Provision button posts to /admin/users/:id/provision-claude; on success the ExternalAccounts section refreshes.
- [x] "Deprovision Student" button shown for student users; opens confirmation listing affected accounts.
- [x] Deprovision posts to /admin/users/:id/deprovision; on partial failure, shows which accounts failed.
- [x] "Add Login" form collects provider, providerUserId, providerEmail; posts to /admin/users/:id/logins.
- [x] "Remove" on each Login row: posts DELETE /admin/users/:id/logins/:loginId.
- [x] Last-login Remove button is disabled with tooltip.
- [x] On all errors, the UI shows the server-returned error message.
- [x] Page state refreshes after each successful action without a full reload.

## Implementation Plan

### Approach

The existing `UsersPanel.tsx` renders a flat user list. Sprint 004 did not add a
user detail view yet (the admin user detail is TBD). This ticket should check
what exists and either:
a. Extend `UsersPanel.tsx` to show a detail panel when a user is clicked (inline
   expansion or a modal), or
b. Create `UserDetailPanel.tsx` as a new component rendered within the admin layout.

Check the current `UsersPanel.tsx` and `ProvisioningRequests.tsx` for the
existing admin panel pattern and follow it.

Each action section:
- External Accounts: fetch from `/admin/users/:id/external-accounts` (add this
  read endpoint if it doesn't exist) or embed in the user detail fetch.
- Logins: fetch from `/admin/users/:id/logins`.

For the confirmation dialog, use the simplest available approach: `window.confirm`
for initial implementation, replaceable with a modal later.

### Files to create/modify

- `client/src/pages/admin/UsersPanel.tsx` (extend) or new `UserDetailPanel.tsx`.
- Possibly `server/src/routes/admin/users.ts` — add GET /users/:id endpoint
  returning user + logins + external accounts if not already present.

### Testing plan

Manual verification against the running dev server. No automated component tests
required for this ticket (Sprint testing strategy focuses on integration tests
at the API layer).

### Documentation updates

None.
