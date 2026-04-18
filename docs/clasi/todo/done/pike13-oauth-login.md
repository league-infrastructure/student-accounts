---
status: pending
priority: high
source: inventory app (server/src/routes/auth.ts, docs/api-integrations.md)
---

# Add Pike 13 as an OAuth Login Provider

The template already has a Pike 13 API proxy route for server-to-server
calls (`/api/pike13/events`, `/api/pike13/people`). This TODO adds Pike 13
as an actual OAuth login provider alongside Google and GitHub, so League
students and staff can authenticate with their Pike 13 accounts.

## Scope

- Add `passport-oauth2` strategy configured for Pike 13's OAuth2 endpoints
- `GET /api/auth/pike13` — initiates OAuth redirect to Pike 13
- `GET /api/auth/pike13/callback` — handles the callback
- On successful login, extract user profile from Pike 13's `/api/v2/desk/me`
  endpoint
- Use the email-based user linking flow (see `email-based-user-linking.md`)
  to find or create the user, setting `pike13Id`

## Pike 13 OAuth Details

- Authorization URL: `https://jtl.pike13.com/oauth/authorize`
- Token URL: `https://jtl.pike13.com/oauth/token`
- User info URL: `https://jtl.pike13.com/api/v2/desk/me`
- Scopes: `read` (covers profile access)
- Required env vars: `PIKE13_CLIENT_ID`, `PIKE13_CLIENT_SECRET`
- Callback URL: `/api/auth/pike13/callback`

## Implementation Notes

Pike 13 uses standard OAuth2 but does not have a dedicated Passport
strategy. Use `passport-oauth2` with custom URLs:

```typescript
import { Strategy as OAuth2Strategy } from 'passport-oauth2';

passport.use('pike13', new OAuth2Strategy({
    authorizationURL: 'https://jtl.pike13.com/oauth/authorize',
    tokenURL: 'https://jtl.pike13.com/oauth/token',
    clientID: process.env.PIKE13_CLIENT_ID,
    clientSecret: process.env.PIKE13_CLIENT_SECRET,
    callbackURL: `${baseUrl}/api/auth/pike13/callback`,
  },
  async (accessToken, refreshToken, profile, done) => {
    // Pike 13 doesn't populate profile — fetch from /api/v2/desk/me
    const res = await fetch('https://jtl.pike13.com/api/v2/desk/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    const pike13User = data.people?.[0];

    const user = await findOrCreateUser({
      id: String(pike13User.id),
      email: pike13User.email,
      displayName: `${pike13User.first_name} ${pike13User.last_name}`,
    }, 'pike13');

    done(null, user);
  }
));
```

## Environment Variables

Add to `config/dev/secrets.env` and `config/prod/secrets.env`:

```
PIKE13_CLIENT_ID=your-pike13-client-id
PIKE13_CLIENT_SECRET=your-pike13-client-secret
```

## Credential Setup References

- Getting started: https://developer.pike13.com/docs/get_started
- Authentication (OAuth2): https://developer.pike13.com/docs/authentication
- Core API v2 reference: https://developer.pike13.com/docs/core-api-v2

## Verification

- Pike 13 login button appears on the login page when credentials are
  configured
- Clicking it redirects to Pike 13, then back with a valid session
- User record created with pike13Id set
- If user already exists (from Google/GitHub login), accounts are linked
- App starts cleanly when Pike 13 credentials are not configured
