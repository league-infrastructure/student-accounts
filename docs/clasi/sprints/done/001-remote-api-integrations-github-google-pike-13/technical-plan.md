---
status: draft
---

# Sprint 001 Technical Plan

## Architecture Overview

This sprint adds three layers to the existing Express + React stack:

```
┌─────────────────────────────────────────────────┐
│  ExampleIntegrations.tsx (DISPOSABLE)            │
│  Single-file React page — delete when done       │
│  Calls: /api/integrations/status                 │
│         /api/auth/me, /api/auth/logout           │
│         /api/auth/github, /api/auth/google       │
│         /api/github/repos                        │
│         /api/pike13/events                       │
└────────────────────┬────────────────────────────┘
                     │ fetch()
┌────────────────────▼────────────────────────────┐
│  Express Backend (PERMANENT)                     │
│                                                  │
│  Middleware (in order):                          │
│    cors → json → pino → session → passport      │
│                                                  │
│  Routes:                                         │
│    /api/integrations/status  (integrations.ts)   │
│    /api/auth/*               (auth.ts)           │
│    /api/github/*             (github.ts)         │
│    /api/pike13/*             (pike13.ts)         │
│    /api/health               (health.ts)  ←exist │
│    /api/counter/*            (counter.ts) ←exist │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   GitHub API   Google API   Pike 13 API
```

## Component Design

### Component: Session & Passport Middleware

**Use Cases**: SUC-002, SUC-003

Added to `server/src/index.ts`, inserted **after** `pinoHttp()` and
**before** route registrations (approximately line 24 in the current file):

- `app.set('trust proxy', 1)` — required for `secure` cookies behind Caddy
- `express-session` configured with:
  - `secret`: `SESSION_SECRET` from env (falls back to a dev default)
  - `resave: false`
  - `saveUninitialized: false`
  - `cookie.secure`: `process.env.NODE_ENV === 'production'`
  - `cookie.sameSite`: `'lax'` (default, works with OAuth redirects)
  - `cookie.httpOnly`: `true`
  - In-memory store (default) — sufficient for dev and single-process prod
- `passport.initialize()` and `passport.session()`
- Passport `serializeUser` / `deserializeUser` — store full user object
  in session (no database user table in this sprint). This is a template
  simplification; real apps should serialize an ID and look up from a
  user table.

**CORS configuration change:** The existing `app.use(cors())` wildcard
is incompatible with credentials. Since all requests flow through the
Vite dev proxy or Caddy in production (never direct cross-origin), **remove
the `cors()` middleware entirely**. The proxy pattern makes CORS unnecessary.
If a future use case needs CORS, it should be configured with explicit
origin and `credentials: true`.

**Dependencies:** `express-session`, `passport`

**Middleware registration order in `index.ts`:**
1. `express.json()` (existing)
2. `pinoHttp()` (existing)
3. `express-session` (new)
4. `passport.initialize()` (new)
5. `passport.session()` (new)
6. Route registrations (existing + new)
7. Error handler (existing, stays last)

### Component: Integration Status Route (`server/src/routes/integrations.ts`)

**Use Cases**: SUC-005

Single endpoint:
- `GET /api/integrations/status` — checks which env vars are set

```typescript
// Returns:
{
  github:  { configured: boolean },
  google:  { configured: boolean },
  pike13:  { configured: boolean }
}
```

Checks:
- GitHub: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` both non-empty
- Google: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` both non-empty
- Pike 13: `PIKE13_ACCESS_TOKEN` non-empty

Note: Production apps may want to gate this endpoint behind
authentication. For the template, it is publicly accessible.

### Component: Auth Routes (`server/src/routes/auth.ts`)

**Use Cases**: SUC-002, SUC-003

Routes:
- `GET /api/auth/github` — `passport.authenticate('github', { scope: [...] })`
- `GET /api/auth/github/callback` — callback handler, redirects to `/`
- `GET /api/auth/google` — `passport.authenticate('google', { scope: [...] })`
- `GET /api/auth/google/callback` — callback handler, redirects to `/`
- `GET /api/auth/me` — returns `req.user` or 401
- `POST /api/auth/logout` — `req.logout()`, destroy session, return 200

**Conditional strategy registration:**
- If `GITHUB_CLIENT_ID` is set → register `passport-github2` strategy
- If `GOOGLE_CLIENT_ID` is set → register `passport-google-oauth20` strategy
- Routes are always registered. If a strategy is missing, the route
  returns `501 { error: "GitHub OAuth not configured", docs: "https://..." }`

**Session data stored on login:**
```typescript
{
  provider: 'github' | 'google',
  id: string,
  displayName: string,
  email: string,
  avatar: string,
  accessToken: string  // stored for API calls (e.g., GitHub repos)
}
```

**Note on access tokens in sessions:** The access token is stored in
the server-side session (not sent to the client). If the session store
is later migrated to Postgres (`connect-pg-simple`), access tokens should
be encrypted at rest or moved to a separate table. This is a known
trade-off for the template's simplicity.

### Component: GitHub API Route (`server/src/routes/github.ts`)

**Use Cases**: SUC-002

Routes:
- `GET /api/github/repos` — calls `https://api.github.com/user/repos`
  with the session's GitHub access token

Returns array of `{ name, description, url, stars, language }`.
Returns 401 if not logged in via GitHub.

### Component: Pike 13 API Route (`server/src/routes/pike13.ts`)

**Use Cases**: SUC-004

Routes:
- `GET /api/pike13/events` — calls Pike 13 Core API v2
  `GET /api/v2/desk/event_occurrences` with date range for current week
- `GET /api/pike13/people` — calls Pike 13 Core API v2
  `GET /api/v2/desk/people` (first page)

**Authentication:** Pike 13 uses OAuth2 authorization code flow. Access
tokens don't expire. For template purposes, the developer obtains a token
through Pike 13's OAuth flow manually and stores it as
`PIKE13_ACCESS_TOKEN`. The route sends `Authorization: Bearer <token>`.

If credentials are missing, returns
`501 { error: "Pike 13 not configured", docs: "https://..." }`.

**API base URL:** `https://pike13.com/api/v2/desk/` (or subdomain-specific).

### Component: Example Page (`client/src/pages/ExampleIntegrations.tsx`)

**Use Cases**: SUC-001, SUC-002, SUC-003, SUC-004, SUC-005

**DISPOSABLE** — this file is deleted when the developer builds their app.

Single React component with:
1. `useEffect` on mount: fetch `/api/integrations/status` and `/api/auth/me`
2. Counter section (existing counter increment demo, inlined)
3. Three integration cards, each showing either:
   - Active state with action button → shows results after interaction
   - "Not configured" muted state with link to docs

All logic is self-contained. No imports from other app-specific modules.
Uses only `react`, `react-dom`, and plain `fetch()`.

**Integration with `App.tsx`:** The current `App.tsx` contains the counter
demo. Replace its contents with an import and render of
`ExampleIntegrations`. To remove the example later:
1. Delete `client/src/pages/ExampleIntegrations.tsx`
2. Revert `client/src/App.tsx` to the counter-only version (or replace
   with your own app root)

This cleanup step will be documented in `docs/api-integrations.md` under
a "Removing the Example Page" section.

### Component: Documentation (`docs/api-integrations.md`)

**Use Cases**: SUC-001

Structured as:
1. Overview — what integrations are available, architecture summary
2. GitHub section — upstream links, env var names, callback URL
3. Google section — upstream links, consent screen note, env var names
4. Pike 13 section — upstream links, token acquisition, env var names
5. Secrets flow — brief explanation linking to `docs/secrets.md`
6. **Removing the example page** — delete `ExampleIntegrations.tsx`,
   revert `App.tsx`, note that backend routes remain functional
7. **Production deployment note** — reminder to remove the example before
   deploying; add needed secrets to Docker Swarm

**Style:** Link to upstream docs, don't paraphrase provider UIs.

### Component: Secret Examples

**Use Cases**: SUC-001

Update `secrets/dev.env.example` and `secrets/prod.env.example`:

```
# --- GitHub OAuth ---
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# --- Google OAuth ---
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# --- Pike 13 API ---
PIKE13_ACCESS_TOKEN=your-pike13-access-token
```

Note: `PIKE13_CLIENT_ID` and `PIKE13_CLIENT_SECRET` are not included in
this sprint. The template uses a pre-obtained access token. Apps that
need the full Pike 13 OAuth redirect flow should add those vars manually.

**Production compose (`docker-compose.prod.yml`):** New secrets are NOT
added to the compose file. The entrypoint.sh pattern loads any secret
files it finds in `/run/secrets/`, so developers add only the secrets
they've created in the swarm. This matches the graceful degradation
philosophy — unconfigured services simply aren't available.

## New Dependencies

| Package | Purpose |
|---------|---------|
| `express-session` | Session middleware |
| `passport` | Authentication framework |
| `passport-github2` | GitHub OAuth2 strategy |
| `passport-google-oauth20` | Google OAuth2 strategy |
| `@types/express-session` | TypeScript types (dev) |
| `@types/passport` | TypeScript types (dev) |
| `@types/passport-github2` | TypeScript types (dev) |
| `@types/passport-google-oauth20` | TypeScript types (dev) |

All installed in `server/package.json`. Versions pinned by `npm install`
in `package-lock.json`.

No new client dependencies (React Router not needed — single page).

## File Changes Summary

| File | Action | Permanent? |
|------|--------|------------|
| `server/package.json` | Add dependencies | Yes |
| `server/src/index.ts` | Remove `cors()`, add session + Passport middleware, register new routes | Yes |
| `server/src/routes/integrations.ts` | New file | Yes |
| `server/src/routes/auth.ts` | New file | Yes |
| `server/src/routes/github.ts` | New file | Yes |
| `server/src/routes/pike13.ts` | New file | Yes |
| `client/src/pages/ExampleIntegrations.tsx` | New file | **No** (disposable) |
| `client/src/App.tsx` | Import/render example page | Revert when deleting example |
| `docs/api-integrations.md` | New file | Yes |
| `secrets/dev.env.example` | Add entries | Yes |
| `secrets/prod.env.example` | Add entries | Yes |
| `docs/secrets.md` | Update required secrets table | Yes |

## Decisions

1. **Pike 13 token acquisition:** Use a pre-obtained `PIKE13_ACCESS_TOKEN`
   stored as an env var. Pike 13 tokens don't expire. Drop
   `PIKE13_CLIENT_ID` / `PIKE13_CLIENT_SECRET` from this sprint — apps
   that need the full OAuth redirect can add those vars later. Document
   the token acquisition process in `docs/api-integrations.md` with links
   to Pike 13's auth docs.

2. **Session store:** In-memory store for this sprint. Sufficient for
   development and single-process production. Document the upgrade path
   to `connect-pg-simple` (Postgres-backed sessions) for when the app
   adds database-backed user accounts.

3. **CORS:** Remove the existing `cors()` wildcard middleware. All
   requests flow through the Vite dev proxy or Caddy reverse proxy —
   direct cross-origin requests are not needed. This avoids the
   incompatibility between wildcard CORS and session cookies.

4. **Production secrets:** New OAuth secrets are NOT added to
   `docker-compose.prod.yml`. The `entrypoint.sh` pattern dynamically
   loads whatever secrets exist in `/run/secrets/`. Developers add only
   the swarm secrets they need. This is documented in
   `docs/api-integrations.md`.

5. **Existing tests:** Any existing tests must continue to pass after
   the changes. The counter endpoint and health check remain functional.
