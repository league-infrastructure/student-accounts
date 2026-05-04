---
id: '011'
title: 'Server: extend PATCH /api/account/credentials for first-time setup + Login
  row creation'
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: extend PATCH /api/account/credentials for first-time setup + Login row creation

## Description

Extend PATCH /api/account/credentials to support a first-time setup path. When
a user has neither a `username` nor a `password_hash` (e.g., they signed up via
passphrase and have not yet chosen credentials), `currentPassword` is not required.
On success, a `Login(provider='passphrase', provider_user_id='self:<userId>:<username>')` 
row is created if one does not already exist.

## Acceptance Criteria

- [x] PATCH /api/account/credentials accepts requests without `currentPassword` when
      the authenticated user has neither `username` nor `password_hash` set.
- [x] On first-time setup success, a passphrase Login row is created with
      `provider='passphrase'`, `provider_user_id='self:<userId>:<username>'`,
      `provider_email=user.primary_email`, `provider_username=username`.
- [x] No duplicate Login row is created if one with that `provider_user_id` already exists.
- [x] Normal path (user has username or password_hash) still requires `currentPassword`.
- [x] Existing tests for the password-required path remain green.

## Testing

- **Existing tests**: `tests/server/routes/account-credentials.test.ts` — all 
  pre-existing tests remain green.
- **New tests**: 7 new test cases covering:
  - First-time setup succeeds without `currentPassword`
  - Username and password_hash are persisted to DB
  - Returns 400 when `currentPassword` absent but user already has credentials
  - Returns 400 when user has username-only (not both absent)
  - Login row created after first-time setup
  - No duplicate Login row created on repeat call
  - No extra Login row created on normal credential update
- **Verification command**: `cd server && npx vitest run "../tests/server/routes/account-credentials.test.ts"`
