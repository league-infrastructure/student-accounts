---
id: '011'
title: Re-add GitHub and Google Passport strategies with find-or-create
status: done
use-cases:
- SUC-008
- SUC-009
depends-on: []
github-issue: ''
todo: plan-social-login-account-linking-for-the-template-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 011 — Re-add GitHub and Google Passport strategies with find-or-create

## Description

Sprint 018 ticket 004 stripped all OAuth Passport strategies as part of the demo-login
reset. This ticket re-introduces the GitHub and Google strategies, guarded by env var
presence, and implements the find-or-create / auto-link logic that binds OAuth identities
to `User` records via `UserProvider` rows.

No UI changes in this ticket. The backend OAuth flows (initiate + callback) must be
functional and testable via browser redirect before the frontend work begins in tickets
014 and 015.

This ticket also fixes `routes/github.ts` to read the access token from
`req.session.githubAccessToken` (where this ticket will store it) rather than
`req.user.accessToken` (dead code since ticket 004).

## Acceptance Criteria

- [x] `passport-github2` strategy is registered in `routes/auth.ts` only when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set
- [x] `passport-google-oauth20` strategy is registered in `routes/auth.ts` only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- [x] `GET /api/auth/github` initiates the GitHub OAuth redirect (requires env vars; returns 501 without them)
- [x] `GET /api/auth/github/callback` completes the flow: find-or-create user, establish session, redirect to `/`
- [x] `GET /api/auth/google` initiates the Google OAuth redirect (requires env vars; returns 501 without them)
- [x] `GET /api/auth/google/callback` completes the flow: find-or-create user, establish session, redirect to `/`
- [x] Link mode: `GET /api/auth/github?link=1` sets `req.session.oauthLinkMode = true` before redirect; callback binds the OAuth identity to the current user rather than creating/finding a user
- [x] Link mode: same for Google
- [x] Find-or-create priority: `(provider, providerId)` first; email auto-link second; new user creation last
- [x] Each successful OAuth login creates a `UserProvider` row if one does not already exist for that `(provider, providerId)`
- [x] Access token stored as `req.session.githubAccessToken` (not on `req.user`)
- [x] `routes/github.ts` reads from `(req.session as any).githubAccessToken` instead of `(req.user as any).accessToken`
- [x] Server boots cleanly with zero OAuth env vars set (no strategy registration errors)
- [x] `passport.deserializeUser` in `app.ts` is unchanged (user ID only)

## Files to Modify

- `server/src/routes/auth.ts` — add strategy registrations, initiate routes, callback routes, and `findOrCreateOAuthUser` helper
- `server/src/routes/github.ts` — change access token source from `user.accessToken` to `(req.session as any).githubAccessToken`

## Files to Create

None.

## Implementation Plan

### Conditional strategy registration

At the top of `auth.ts` (outside the router, at module load time), register each strategy
only when the corresponding env vars are present:

```typescript
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use('github', new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: '/api/auth/github/callback',
    scope: ['read:user', 'user:email'],
    passReqToCallback: true,
  }, async (req: any, accessToken: string, _rt: any, profile: any, done: any) => {
    (req.session as any).githubAccessToken = accessToken;
    try {
      const user = await findOrCreateOAuthUser(
        req, 'github', profile.id,
        profile.emails?.[0]?.value,
        profile.displayName ?? profile.username,
      );
      done(null, user);
    } catch (err) { done(err); }
  }));
}
```

Same pattern for Google using `passport-google-oauth20`.

### `findOrCreateOAuthUser` helper

Extract as a module-private `async` function in `auth.ts`:

1. Look up `UserProvider` where `{ provider, providerId }`.
   If found, fetch and return the associated `User`.
2. If `(req.session as any).oauthLinkMode` is true:
   - Require `req.user`; reject with an Error if no session user.
   - Upsert a `UserProvider` row linking to `req.user.id`.
   - Clear `(req.session as any).oauthLinkMode`.
   - Return `req.user`.
3. If email is present: look up `User` by `{ email }`. If found, create `UserProvider`
   row on that user; return that user.
4. Create new `User` (email, displayName, role=USER, provider, providerId) + new
   `UserProvider` row; return the new user.

### Initiate routes

```typescript
authRouter.get('/auth/github', (req, res, next) => {
  if (!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
    return res.status(501).json({ error: 'GitHub OAuth not configured' });
  }
  if (req.query.link === '1') (req.session as any).oauthLinkMode = true;
  passport.authenticate('github')(req, res, next);
});

authRouter.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => {
    const linkMode = (req.session as any).oauthLinkMode;
    // oauthLinkMode is already cleared inside findOrCreateOAuthUser
    res.redirect(linkMode ? '/account' : '/');
  }
);
```

Note: The callback must check for link mode BEFORE clearing it (the helper already clears
it). One approach: read `req.session.oauthLinkMode` before calling authenticate (store in
local var), then use that for redirect decision. See implementation note in architecture
addendum.

### Access token fix in github.ts

```typescript
// Before (dead code since ticket 004):
if (!user || user.provider !== 'github' || !user.accessToken) {

// After:
const githubToken = (req.session as any).githubAccessToken;
if (!user || user.provider !== 'github' || !githubToken) {
```

Then use `githubToken` in the Authorization header instead of `user.accessToken`.

### Testing Plan

Write tests in `server/src/routes/auth.test.ts` (or a new file) using supertest:
- No OAuth env vars → `/api/auth/github` returns 501
- `findOrCreateOAuthUser`: test all four branches by exercising callback logic via the
  `POST /api/auth/test-login` endpoint to set up fixture users, then call helper directly
  or via mocked strategy callbacks (use vitest mocks for Passport strategy execution)
- New user creation: `UserProvider` row created, `User` row created
- Email auto-link: existing user gets `UserProvider` row, no new `User` created
- Link mode: existing session user gets new `UserProvider`, no new `User` created
- Cross-user collision in link mode: error returned, no rows created

## Testing

- **Existing tests to run**: `cd server && npm test` — verify auth and all other existing tests pass
- **New tests to write**: `findOrCreateOAuthUser` integration tests (all four branches), 501 guard for unconfigured providers
- **Verification command**: `cd server && npm test`
