---
id: "002"
title: "Google OAuth strategy — sign-in handler and UC-001 happy path"
status: todo
use-cases: [SUC-001]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# T002: Google OAuth strategy — sign-in handler and UC-001 happy path

## Description

Implement the shared `SignInHandler` service function and wire the Google OAuth
strategy into it. The sign-in handler is the core business logic that runs after
any OAuth callback: it looks up (or creates) a User and Login, calls the
merge-scan stub for new users, writes `userId` and `role` to the session, and
returns the User.

This ticket covers UC-001 (Google sign-in, new user) and the returning-user
variant. Staff OU detection is added in T005 — this ticket handles non-staff
Google accounts only.

## Acceptance Criteria

- [ ] `server/src/services/auth/sign-in.handler.ts` is implemented as a pure
      service function (no Express types in its signature).
- [ ] `GET /api/auth/google` redirects to Google OAuth consent screen when
      credentials are configured.
- [ ] On successful Google callback with an unknown identity: a new User record
      is created (`role=student`, `created_via=social_login`) and a new Login
      record is created (`provider=google`), both atomically with their
      AuditEvents.
- [ ] `req.session.userId` and `req.session.role` are set after successful
      sign-in.
- [ ] On successful Google callback with a known identity: no new User or Login
      is created; session is established for the existing User.
- [ ] OAuth denied or error: redirect to `/?error=oauth_denied`; no User or
      Login created.
- [ ] `mergeScan` stub is called after new User creation (verified by log output
      in tests).
- [ ] `GET /account` returns HTTP 200 with placeholder text after sign-in
      (stub landing route).
- [ ] All existing tests pass (`npm run test:server`).

## Implementation Plan

### Approach

1. Write `sign-in.handler.ts` — takes `(provider, profile, options?)` and
   returns `User`. Calls `UserService.createWithAudit` and `LoginService.create`
   for new users. Calls `mergeScan` from T006's stub module.
2. Write `server/src/routes/auth.ts` — mount `GET /api/auth/google` and
   `GET /api/auth/google/callback` using the Google strategy from T001.
   The callback invokes the sign-in handler and writes session fields.
3. Register `routes/auth.ts` in `app.ts`.
4. Add stub `GET /account` route in `app.ts` or a new `routes/account.ts`.

### Files to Create

- `server/src/services/auth/sign-in.handler.ts`
- `server/src/routes/auth.ts`

### Files to Modify

- `server/src/app.ts` — mount `routes/auth.ts`; add stub `/account` route.
- `server/src/services/auth/passport.config.ts` (from T001) — wire
  `signInHandler` as the Google strategy verify callback.

### Testing Plan

- `tests/server/helpers/passport-test-setup.ts` — implement
  `MockGoogleStrategy` that bypasses the OAuth redirect and calls the verify
  callback directly with a controlled profile object.
- `tests/server/services/auth/sign-in.handler.test.ts` (or
  `tests/server/routes/auth.google.test.ts`) — integration tests:
  - New user created on first Google sign-in.
  - Existing user signed in on subsequent Google sign-in.
  - OAuth error redirects to sign-in page.
  - Session contains `userId` and `role` after sign-in.
  - `mergeScan` log message appears in test output for new users.

### Documentation Updates

None required beyond code.
