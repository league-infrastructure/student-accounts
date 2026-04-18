---
id: "004"
title: "Google Admin Directory client — abstraction and injection interface"
status: todo
use-cases: [SUC-003]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# T004: Google Admin Directory client — abstraction and injection interface

## Description

Implement the `AdminDirectoryClient` interface and its two concrete
implementations: `GoogleAdminDirectoryClient` (real, using `googleapis`) and
`FakeAdminDirectoryClient` (for tests). Install the `googleapis` npm package.
Wire the real client in `passport.config.ts` when
`GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_ADMIN_DELEGATED_USER_EMAIL` are
present; skip gracefully when absent.

This ticket does not wire the client into the sign-in flow — that is T005.
It delivers the abstraction and verifies the interface independently.

## Acceptance Criteria

- [ ] `googleapis` is installed as a production dependency.
- [ ] `server/src/services/auth/google-admin-directory.client.ts` exports:
  - `AdminDirectoryClient` interface with `getUserOU(email: string): Promise<string>`.
  - `GoogleAdminDirectoryClient` class implementing the interface, using a
    service account JSON and delegated user email for domain-wide delegation.
    Scope: `admin.directory.user.readonly`.
  - `FakeAdminDirectoryClient` class that returns a configured OU path string
    without network calls.
  - `StaffOULookupError` typed error class.
- [ ] `GoogleAdminDirectoryClient.getUserOU` calls the Google Admin SDK
      `users.get` endpoint, reads `orgUnitPath`, and returns it.
- [ ] `GoogleAdminDirectoryClient.getUserOU` throws `StaffOULookupError` on
      any API failure (network error, auth error, user not found).
- [ ] When `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_ADMIN_DELEGATED_USER_EMAIL`
      are absent or misconfigured, the app still starts cleanly (no crash on
      startup). However, `GoogleAdminDirectoryClient` must throw
      `StaffOULookupError` immediately when `getUserOU` is called — it must NOT
      return a default value or silently skip the check. This ensures that a
      missing credential causes a hard deny at sign-in time rather than silently
      granting student access to an unverified `@jointheleague.org` account.
      The error must be logged at ERROR level with enough context for an operator
      to diagnose the misconfiguration. (RD-001)
- [ ] `config/dev/secrets.env.example` updated with
      `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_ADMIN_DELEGATED_USER_EMAIL`,
      and `GOOGLE_STAFF_OU_PATH` placeholders.
- [ ] All existing tests pass.

## Implementation Plan

### Approach

1. Install `googleapis`.
2. Write the interface, `GoogleAdminDirectoryClient`, `FakeAdminDirectoryClient`,
   and `StaffOULookupError` in one file.
3. Update `passport.config.ts` to instantiate the real client when env vars
   are present, storing it for injection in T005.

### Files to Create

- `server/src/services/auth/google-admin-directory.client.ts`

### Files to Modify

- `server/package.json` — add `googleapis`.
- `server/src/services/auth/passport.config.ts` — instantiate and export
  the admin directory client.
- `config/dev/secrets.env.example` — add Admin SDK credential placeholders.
- `config/prod/secrets.env.example` — add Admin SDK credential placeholders.

### Testing Plan

- `tests/server/services/auth/google-admin-directory.client.test.ts`:
  - `FakeAdminDirectoryClient` returns the configured OU path.
  - `FakeAdminDirectoryClient` throwing `StaffOULookupError` propagates correctly.
  - `GoogleAdminDirectoryClient` is not exercised against the real API in CI
    (requires credentials). If credentials are present in the environment, an
    optional smoke test can be included; otherwise this class is covered via
    the integration tests in T005 (which use the fake).

### Documentation Updates

- `config/dev/secrets.env.example` and `config/prod/secrets.env.example`
  updated with new env var placeholders and explanatory comments.
