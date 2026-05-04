---
id: '015'
title: 'Client: Add username/password button + modal in Account LoginsSection'
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: Add username/password button + modal in Account LoginsSection

## Description

Adds an "Add username/password" button to the LoginsSection add row in
`Account.tsx`. Visible only when the user has neither a username nor a
password_hash (i.e. the button is hidden once hasCredentials is true).

Clicking the button opens `AddCredentialsModal` — a small inline modal
that collects username + password (with confirm) and calls
`PATCH /api/account/credentials` with `{ username, newPassword }` (no
currentPassword — first-time-setup path added in Sprint 028 ticket 011).
On success, the modal closes and the `['account']` query is invalidated so
the new passphrase Login row appears in the LoginsSection table automatically.

## Acceptance Criteria

- [x] "Add username/password" button appears in LoginsSection addRow when `profile.username === null && profile.has_password !== true`
- [x] Button is hidden when user already has credentials (`hasCredentials === true`)
- [x] Clicking the button opens `AddCredentialsModal`
- [x] Modal collects username, password, and confirm-password fields
- [x] Submit sends `PATCH /api/account/credentials` with `{ username, newPassword }` and no `currentPassword`
- [x] On success: modal closes and `['account']` query is invalidated
- [x] Client-side validation: passwords must match; shows inline error if not
- [x] Cancel button closes the modal without submitting

## Testing

- **Existing tests to run**: `npm run test:client -- Account` — all 53 pass
- **New tests to write**: 9 new tests in `tests/client/pages/Account.test.tsx`
  under describe block "Account page — Add username/password button"
- **Verification command**: `npm run test:client -- Account`
