---
id: '001'
title: OAuth config, secrets wiring, and Passport session setup
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on: []
github-issue: ''
todo: ''
---

# T001: OAuth config, secrets wiring, and Passport session setup

## Description

Install `passport`, `passport-google-oauth20`, `passport-github2`, and
`express-session` type declarations (already in use from Sprint 001 for
session infra). Wire all OAuth environment variables into a validated config
module. Complete the `passport.serializeUser` / `passport.deserializeUser`
stubs left in `app.ts` by Sprint 001. Add a `passport.config.ts` module that
reads env vars and exports configured strategy instances. Register
`passport.initialize()` and `passport.session()` in `app.ts`. Add the
`req.session` type extension (`userId`, `role`).

This ticket does not implement any OAuth routes — it is the foundation that
T002 and T003 build on.

## Acceptance Criteria

- [x] `passport`, `passport-google-oauth20`, `passport-github2` are installed
      as production dependencies.
- [x] A `server/src/services/auth/passport.config.ts` module exists that reads
      `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
      `GOOGLE_CALLBACK_URL`, `GITHUB_OAUTH_CLIENT_ID`,
      `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` from `process.env`.
- [x] Missing OAuth env vars cause the affected strategy to be skipped (not
      registered); the app still starts cleanly.
- [x] `passport.serializeUser` stores `user.id`; `passport.deserializeUser`
      loads the User from the database by id and calls `done(null, user)`.
- [x] `passport.initialize()` and `passport.session()` are registered in
      `app.ts` in correct middleware order (after `express-session`, before
      routes).
- [x] `req.session` is extended with typed fields `userId: number` and
      `role: UserRole` via a `express-session` module augmentation.
- [x] `config/dev/secrets.env.example` and `config/prod/secrets.env.example`
      are updated to include all 6 OAuth env vars (`GOOGLE_OAUTH_CLIENT_ID`,
      `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`,
      `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`,
      `GITHUB_CALLBACK_URL`).
- [x] `npm run test:server` passes (257 existing tests still green).

## Implementation Plan

### Approach

Pure configuration and plumbing — no business logic. Install packages, write
the config module, complete the stubs, extend the session type.

### Files to Create

- `server/src/services/auth/passport.config.ts` — strategy factory, reads env
  vars, returns configured strategy instances (or null if credentials absent).

### Files to Modify

- `server/package.json` — add `passport`, `passport-google-oauth20`,
  `passport-github2` and their `@types/*` packages.
- `server/src/app.ts` — complete `serializeUser`/`deserializeUser` stubs;
  register `passport.initialize()` and `passport.session()`; import
  `passport.config.ts`.
- `server/src/env.ts` or a new `server/src/config/auth.config.ts` — expose
  OAuth env var reads with graceful fallback.
- `config/dev/secrets.env.example` — add OAuth var placeholders.
- `config/prod/secrets.env.example` — add OAuth var placeholders.

### Session type extension location

Add a `server/src/types/session.d.ts` (or inline in `app.ts`) for the
`express-session` module augmentation. Using a dedicated `types/` file is
preferred for discoverability.

### Testing Plan

- Run `npm run test:server` to verify the existing 257 tests still pass after
  middleware registration changes.
- No new test file for this ticket — the passport setup is verified as part of
  T002/T003 integration tests.

### Documentation Updates

- `config/dev/secrets.env.example` and `config/prod/secrets.env.example` updated
  with OAuth credential placeholders and comments.
