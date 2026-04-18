---
id: '005'
title: Implement Google OAuth auth routes
status: done
use-cases:
- SUC-003
depends-on:
- '004'
---

# Implement Google OAuth auth routes

## Description

Add Google OAuth login to the existing auth route file using Passport.js
Google strategy.

## Changes

1. **`server/package.json`** — install:
   - Runtime: `passport-google-oauth20`
   - Dev: `@types/passport-google-oauth20`

2. **`server/src/routes/auth.ts`** — add to existing file:
   - Conditionally register `passport-google-oauth20` strategy if
     `GOOGLE_CLIENT_ID` is set
   - `GET /api/auth/google` — initiates OAuth redirect.
     Returns 501 with docs URL if strategy not configured.
   - `GET /api/auth/google/callback` — handles callback, stores profile
     in session, redirects to `/`
   - Scopes: `profile`, `email`
   - Callback URL: `/api/auth/google/callback`

## Credential Setup References

Include these URLs in 501 error responses and code comments:
- Create credentials: https://console.cloud.google.com/apis/credentials
- OAuth 2.0 for web: https://developers.google.com/identity/protocols/oauth2/web-server
- Consent screen: https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient

## Acceptance Criteria

- [ ] `GET /api/auth/google` redirects to Google when configured
- [ ] `GET /api/auth/google` returns 501 with docs URL when not configured
- [ ] Callback stores Google profile in session
- [ ] `/api/auth/me` returns Google user data after login
- [ ] Server starts cleanly without Google env vars

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: Add to `tests/server/auth.test.ts`
  - `GET /api/auth/google` with no credentials → 501 with `{ error, docs }` shape
  - 501 response body contains the Google setup docs URL
  - (OAuth redirect and callback require real credentials — manual test only)
- **Verification command**: `npm run test:server`
