---
id: '004'
title: Implement GitHub OAuth auth routes
status: done
use-cases:
- SUC-002
depends-on:
- '002'
---

# Implement GitHub OAuth auth routes

## Description

Add GitHub OAuth login using Passport.js. Create the auth route file with
GitHub strategy, shared `/api/auth/me` and `/api/auth/logout` endpoints.

## Changes

1. **`server/package.json`** — install:
   - Runtime: `passport-github2`
   - Dev: `@types/passport-github2`

2. **`server/src/routes/auth.ts`** (new):
   - Conditionally register `passport-github2` strategy if
     `GITHUB_CLIENT_ID` is set. Log info line if not configured.
   - `GET /api/auth/github` — initiates OAuth redirect.
     Returns 501 with docs URL if strategy not configured.
   - `GET /api/auth/github/callback` — handles callback, stores profile
     + access token in session, redirects to `/`
   - `GET /api/auth/me` — returns `req.user` or 401
   - `POST /api/auth/logout` — destroys session, returns 200
   - Scopes: `read:user`, `user:email`
   - Callback URL: `/api/auth/github/callback`

3. **`server/src/index.ts`** — register auth router

## Credential Setup References

Include these URLs in 501 error responses and code comments:
- Create OAuth App: https://github.com/settings/developers
- GitHub OAuth docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- Scopes: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps

## Acceptance Criteria

- [ ] `GET /api/auth/github` redirects to GitHub when configured
- [ ] `GET /api/auth/github` returns 501 with docs URL when not configured
- [ ] `GET /api/auth/github/callback` stores user in session and redirects to `/`
- [ ] `GET /api/auth/me` returns user data after login
- [ ] `GET /api/auth/me` returns 401 when not logged in
- [ ] `POST /api/auth/logout` destroys session
- [ ] Server starts cleanly without GitHub env vars

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `tests/server/auth.test.ts`
  - `GET /api/auth/github` with no credentials → 501 with `{ error, docs }` shape
  - `GET /api/auth/me` when not logged in → 401
  - `POST /api/auth/logout` when not logged in → handles gracefully (200 or 401)
  - 501 response body contains the GitHub setup docs URL
  - (OAuth redirect and callback require real credentials — manual test only)
- **Verification command**: `npm run test:server`
