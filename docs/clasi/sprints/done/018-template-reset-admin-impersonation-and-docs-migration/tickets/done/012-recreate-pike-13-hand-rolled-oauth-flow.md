---
id: '012'
title: Recreate Pike 13 hand-rolled OAuth flow
status: done
use-cases:
- SUC-010
depends-on:
- '011'
github-issue: ''
todo: plan-social-login-account-linking-for-the-template-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 012 — Recreate Pike 13 hand-rolled OAuth flow

## Description

`server/src/routes/pike13.ts` was deleted in ticket 001 (it previously contained the
Pike 13 events/people API routes). This ticket recreates it with a hand-rolled OAuth 2.0
authorization code flow (Pike 13 has no Passport strategy) and the same find-or-create /
auto-link / link-mode logic introduced for GitHub and Google in ticket 011.

The `findOrCreateOAuthUser` helper from ticket 011 is reused directly. This ticket only
adds Pike 13-specific: the authorization redirect, the token exchange, the profile fetch,
and the router wiring.

Depends on ticket 011 because `findOrCreateOAuthUser` must exist before this ticket runs.

## Acceptance Criteria

- [x] `GET /api/auth/pike13` redirects to the Pike 13 authorization URL when `PIKE13_CLIENT_ID` and `PIKE13_CLIENT_SECRET` are set
- [x] `GET /api/auth/pike13` returns 501 when `PIKE13_CLIENT_ID` or `PIKE13_CLIENT_SECRET` is not set
- [x] `GET /api/auth/pike13?link=1` sets link mode (same session flag as GitHub/Google)
- [x] `GET /api/auth/pike13/callback` exchanges the authorization code for an access token
- [x] Token exchange uses the correct Pike 13 token endpoint and parameters (see implementation plan)
- [x] After token exchange, fetches the authenticated user's email and display name from the Pike 13 API
- [x] Runs `findOrCreateOAuthUser` with provider `'pike13'` and the fetched identity
- [x] Pike 13 access token stored as `req.session.pike13AccessToken`
- [x] On success: redirects to `/account` (link mode) or `/` (login mode)
- [x] On token exchange failure or profile fetch failure: redirects to `/login` with an error message or logs error
- [x] `pike13Router` registered in `app.ts` at `/api`
- [x] Server boots cleanly when Pike 13 env vars are absent

## Files to Create

- `server/src/routes/pike13.ts` — new file with initiate route, callback route, token exchange helper, profile fetch helper

## Files to Modify

- `server/src/app.ts` — import and register `pike13Router` at `/api`
- `server/src/routes/auth.ts` — export `findOrCreateOAuthUser` so pike13.ts can import it (if not already exported)

## Implementation Plan

### Authorization redirect

Pike 13 authorization URL: `https://pike13.com/oauth/authorize`

Query parameters:
- `client_id` = `PIKE13_CLIENT_ID`
- `response_type` = `code`
- `redirect_uri` = callback URL (dev: `http://localhost:5173/api/auth/pike13/callback`)

```typescript
pike13Router.get('/auth/pike13', (req, res) => {
  if (!(process.env.PIKE13_CLIENT_ID && process.env.PIKE13_CLIENT_SECRET)) {
    return res.status(501).json({ error: 'Pike 13 OAuth not configured' });
  }
  if (req.query.link === '1') (req.session as any).oauthLinkMode = true;
  const params = new URLSearchParams({
    client_id: process.env.PIKE13_CLIENT_ID,
    response_type: 'code',
    redirect_uri: callbackUrl(),
  });
  res.redirect(`https://pike13.com/oauth/authorize?${params}`);
});
```

### Token exchange

Pike 13 token endpoint: `POST https://pike13.com/oauth/token`

Body parameters:
- `grant_type` = `authorization_code`
- `code` = `req.query.code`
- `redirect_uri` = same callback URL
- `client_id` = `PIKE13_CLIENT_ID`
- `client_secret` = `PIKE13_CLIENT_SECRET`

Response: JSON with `access_token` field.

### Profile fetch

**Open Question (flagged in architecture addendum):** The exact Pike 13 people endpoint
for fetching the authenticated user's own profile must be confirmed. The most likely
candidate is `GET https://pike13.com/api/v2/desk/people` or a similar endpoint. Consult
`.claude/rules/api-integrations.md` and the Pike 13 API docs at
`https://developer.pike13.com`.

The response should contain an email address and a name. If the endpoint is a list, take
the first entry that matches the authenticated user (some versions of the API return a
`people` array with a single record for the token owner).

Document the chosen endpoint and response shape in a comment in `pike13.ts`.

### Callback route

```typescript
pike13Router.get('/auth/pike13/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/login');
  try {
    const token = await exchangeCodeForToken(code as string);
    (req.session as any).pike13AccessToken = token;
    const profile = await fetchPike13Profile(token);
    const user = await findOrCreateOAuthUser(
      req, 'pike13', String(profile.id), profile.email, profile.name
    );
    req.login(user, (err) => {
      if (err) return res.redirect('/login');
      const wasLinkMode = !(req.session as any).oauthLinkMode; // already cleared
      res.redirect(wasLinkMode ? '/' : '/account');
    });
  } catch (err) {
    console.error('Pike 13 OAuth callback error', err);
    res.redirect('/login');
  }
});
```

Note: `req.login` establishes the Passport session (calls `serializeUser`). In link mode,
the user is already logged in and `findOrCreateOAuthUser` returns `req.user` — calling
`req.login` again is a no-op for the same user but harmless.

### Wiring in app.ts

```typescript
import { pike13Router } from './routes/pike13';
// ...
app.use('/api', pike13Router);
```

### Testing Plan

This ticket reuses `findOrCreateOAuthUser` from ticket 011. Testing focuses on the
Pike 13-specific wiring:

- `GET /api/auth/pike13` with no env vars → 501
- Callback with no `code` param → redirect to `/login`
- Token exchange failure (mock fetch to return 400) → redirect to `/login`
- Profile fetch failure (mock fetch to return error) → redirect to `/login`
- Successful end-to-end: mock `exchangeCodeForToken` and `fetchPike13Profile` to return
  fixture data; verify `findOrCreateOAuthUser` is called with provider `'pike13'`

Integration testing of the full flow requires actual Pike 13 credentials (manual test only).

## Testing

- **Existing tests to run**: `cd server && npm test` — verify all existing tests pass after app.ts change
- **New tests to write**: pike13 route unit tests with mocked fetch (501 guard, error redirects, successful callback)
- **Verification command**: `cd server && npm test`
