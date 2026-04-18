---
name: api-integrations
description: GitHub, Google, and Pike 13 OAuth setup — routes, credentials, and integration patterns
paths:
  - "server/src/routes/**"
  - "server/src/**/*auth*"
  - "server/src/**/*integration*"
  - "client/src/pages/**"
  - "config/**"
---
# API Integrations

This template ships with backend routes for three external services:
**GitHub**, **Google**, and **Pike 13**. All routes degrade gracefully —
the server starts and serves traffic with zero integration credentials
configured.

## Architecture

```
Browser → /api/auth/github     → Passport GitHub OAuth → session
       → /api/auth/google     → Passport Google OAuth → session
       → /api/github/repos    → GitHub API (user token from session)
       → /api/pike13/events   → Pike 13 API (server-side token)
       → /api/pike13/people   → Pike 13 API (server-side token)
       → /api/integrations/status → reports which services are configured
       → /api/auth/me         → current user (any provider)
       → /api/auth/logout     → destroy session
```

All routes return **501** with a `docs` URL when the required credentials
are not configured.

---

## GitHub OAuth

**Setup:** <https://github.com/settings/developers>
(Create an OAuth App under your GitHub account or organization.)

**OAuth docs:** <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app>

| Setting | Value |
|---------|-------|
| Environment variables | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Callback URL (dev) | `http://localhost:5173/api/auth/github/callback` |
| Callback URL (prod) | `https://<app>.jtlapp.net/api/auth/github/callback` |
| Scopes requested | `read:user`, `user:email` |

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/github` | Initiates OAuth redirect |
| GET | `/api/auth/github/callback` | Handles callback, stores user in session |
| GET | `/api/github/repos` | Returns authenticated user's repositories |

---

## Google OAuth

**Setup:** <https://console.cloud.google.com/apis/credentials>
(Create an OAuth 2.0 Client ID. You will need to configure the consent screen first.)

**OAuth docs:** <https://developers.google.com/identity/protocols/oauth2/web-server>

**Consent screen:** <https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient>

| Setting | Value |
|---------|-------|
| Environment variables | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Callback URL (dev) | `http://localhost:5173/api/auth/google/callback` |
| Callback URL (prod) | `https://<app>.jtlapp.net/api/auth/google/callback` |
| Scopes requested | `profile`, `email` |

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/google` | Initiates OAuth redirect |
| GET | `/api/auth/google/callback` | Handles callback, stores user in session |

---

## Pike 13

**App registration:** <https://developer.pike13.com>
(Register an application to obtain client credentials.)

**Authentication docs:** <https://developer.pike13.com/docs/authentication>

**API docs:** <https://developer.pike13.com/docs/get_started>

Pike 13 implements a standard OAuth 2.0 authorization code flow:

1. Direct users to the authorization endpoint to grant access
2. Receive an authorization code at your callback URL
3. Exchange the code for an access token at the token endpoint

**Pike 13 access tokens do not expire**, so no refresh token logic is needed.
However, tokens can be revoked, so handle 401 responses gracefully.

| Setting | Value |
|---------|-------|
| Environment variables | `PIKE13_CLIENT_ID`, `PIKE13_CLIENT_SECRET`, `PIKE13_ACCESS_TOKEN` |
| Authorization endpoint | `https://pike13.com/oauth/authorize` (or `https://BUSINESS.pike13.com/oauth/authorize`) |
| Token endpoint | `https://pike13.com/oauth/token` |
| Callback URL (dev) | `http://localhost:5173/api/auth/pike13/callback` |
| Callback URL (prod) | `https://<app>.jtlapp.net/api/auth/pike13/callback` |
| API base URL (default) | `https://pike13.com/api/v2/desk` |
| API base URL (override) | Set `PIKE13_API_BASE` for subdomain-specific businesses |

**Authorization request parameters:**

| Parameter | Value |
|-----------|-------|
| `client_id` | Your `PIKE13_CLIENT_ID` |
| `response_type` | `code` |
| `redirect_uri` | Your callback URL (must match registered value exactly) |

**Token exchange parameters:**

| Parameter | Value |
|-----------|-------|
| `grant_type` | `authorization_code` |
| `code` | The authorization code from the callback |
| `redirect_uri` | Same callback URL used in the authorization request |
| `client_id` | Your `PIKE13_CLIENT_ID` |
| `client_secret` | Your `PIKE13_CLIENT_SECRET` |

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pike13/events` | This week's event occurrences |
| GET | `/api/pike13/people` | First page of people |

---

## Shared Auth Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Returns current user or 401 |
| POST | `/api/auth/logout` | Destroys session |
| GET | `/api/integrations/status` | Reports which services are configured |

---

## Secrets Flow

Credentials flow through the secrets pipeline documented in
`.claude/rules/secrets.md`:

1. Add values to `config/dev/secrets.env` (encrypted with SOPS + age)
2. Run `./scripts/install.sh` to decrypt into `.env`
3. The server reads `.env` via `dotenv` at startup
4. In production: secrets are Docker Swarm secrets loaded by
   `docker/entrypoint.sh`

See `config/dev/secrets.env.example` for the full list of available variables.

---

## Removing the Example Page

The example integration page (`client/src/pages/ExampleIntegrations.tsx`)
is designed to be deleted. To remove it:

1. Delete `client/src/pages/ExampleIntegrations.tsx`
2. Revert `client/src/App.tsx` to your application's root component
3. Optionally delete `client/src/App.css` if unused

The backend routes (`auth.ts`, `github.ts`, `pike13.ts`,
`integrations.ts`) remain available for your application to use.

---

## Production Notes

Before deploying to production:

1. Create Swarm secrets for any integrations you use:
   - `github_client_id`, `github_client_secret`
   - `google_client_id`, `google_client_secret`
   - `pike13_access_token`

2. Set callback URLs in each provider's settings to use your production
   domain (e.g., `https://myapp.jtlapp.net/api/auth/github/callback`)

3. Remove or replace `ExampleIntegrations.tsx` with your actual
   application UI
