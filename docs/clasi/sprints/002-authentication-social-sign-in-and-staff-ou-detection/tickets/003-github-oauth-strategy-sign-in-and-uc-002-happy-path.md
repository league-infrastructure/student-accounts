---
id: "003"
title: "GitHub OAuth strategy — sign-in and UC-002 happy path"
status: todo
use-cases: [SUC-002]
depends-on: ["002"]
github-issue: ""
todo: ""
---

# T003: GitHub OAuth strategy — sign-in and UC-002 happy path

## Description

Add the GitHub OAuth strategy to the existing auth routes and wire it to the
shared `SignInHandler` (from T002). Implement the `provider_username` migration
for the `Login` table (new nullable column added by this sprint). Handle the
GitHub no-public-email edge case with a placeholder primary_email.

## Acceptance Criteria

- [ ] Prisma migration adds `provider_username String?` column to `Login`.
      Migration is compatible with both SQLite (test) and Postgres (production).
- [ ] `GET /api/auth/github` redirects to GitHub OAuth consent screen when
      credentials are configured.
- [ ] On successful GitHub callback with an unknown identity: a new User and
      Login are created. The GitHub username is stored in `Login.provider_username`.
- [ ] When GitHub returns no public email, `primary_email` is set to
      `<github_username>@github.invalid`, a warning is logged, and sign-in
      completes normally (sign-in is NOT blocked). The `.invalid` domain is an
      RFC-reserved sentinel that cannot be a real address. The student may update
      their primary email on the account page (Sprint 003). (RD-002)
- [ ] On successful GitHub callback with a known identity: no new records
      created; session established for existing User.
- [ ] OAuth denied or error: redirect to `/?error=oauth_denied`.
- [ ] `mergeScan` stub is called after new User creation.
- [ ] `GET /account` stub route is accessible after GitHub sign-in.
- [ ] All existing tests pass (`npm run test:server`).

## Implementation Plan

### Approach

1. Generate and apply Prisma migration: `ALTER TABLE "Login" ADD COLUMN "provider_username" TEXT`.
2. Wire GitHub strategy in `passport.config.ts` to call `signInHandler` with
   `provider='github'` and the GitHub profile object.
3. Add `GET /api/auth/github` and `GET /api/auth/github/callback` routes to
   `routes/auth.ts`.
4. Handle no-public-email in the GitHub branch of `signInHandler` (or in a
   profile normalizer).

### Files to Create

- `server/prisma/migrations/<timestamp>_add_login_provider_username/migration.sql`

### Files to Modify

- `server/prisma/schema.prisma` — add `provider_username String?` to `Login`.
- `server/src/routes/auth.ts` — add GitHub routes.
- `server/src/services/auth/passport.config.ts` — register GitHub strategy.
- `server/src/services/auth/sign-in.handler.ts` — accept `provider_username`
  in profile input; handle placeholder email fallback.

### Testing Plan

- `MockGitHubStrategy` in `tests/server/helpers/passport-test-setup.ts`.
- `tests/server/routes/auth.github.test.ts`:
  - New user created, `provider_username` stored.
  - Existing user signed in.
  - No-public-email → placeholder stored.
  - OAuth error handled.

### Documentation Updates

None beyond migration file and schema.
