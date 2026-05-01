---
id: '005'
title: GET /oauth/authorize with login-redirect and consent-skip
status: done
use-cases:
- SUC-019-001
- SUC-019-004
depends-on:
- '001'
- '002'
- '003'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GET /oauth/authorize with login-redirect and consent-skip

## Description

Extend `server/src/routes/oauth.ts` (the file created in sprint 018 for
`POST /oauth/token`) with a new `GET /authorize` handler. Per
`architecture-update.md` § "Modified Modules (Server)" and
`sprint.md` § Solution step 2.

Also create the consent-lookup service
`server/src/services/oauth/oauth-consent.service.ts` (registered as
`oauthConsents`) per `architecture-update.md` § "New Modules (Server)":

```ts
find(args: { user_id: number; client_id: number; scopes: string[] }):
  Promise<OAuthConsent | null>; // matches if existing.scopes ⊇ requested

record(args: { user_id: number; client_id: number; scopes: string[] }):
  Promise<OAuthConsent>; // upserts on (user_id, oauth_client_id)
```

`find` returns the existing row only if `requested ⊆ stored.scopes` —
do not return a row whose stored scopes are a strict subset of the
ask.

**`GET /oauth/authorize` query params** (validate exhaustively before
any DB write; on validation failure return 400 with
`{ error: 'invalid_request', error_description: '...' }`):

- `response_type` — must equal `"code"`.
- `client_id` — string; look up via the existing
  `oauthClients` service (sprint 018). Unknown or `disabled_at !== null`
  → 401 `invalid_client`.
- `redirect_uri` — required. Validate via
  `matchesRedirectUri(client.redirect_uris, redirect_uri)` from ticket
  002. Mismatch → 400 `invalid_request`. Per OAuth spec, do NOT
  redirect to an unverified `redirect_uri`; render an error directly.
- `code_challenge` — required, non-empty.
- `code_challenge_method` — must equal `"S256"`. Anything else
  (including `plain`) → 400 `invalid_request`.
- `scope` — space-separated. Intersect with `client.allowed_scopes`;
  empty intersection → 400 `invalid_scope`.
- `state` — opaque string, passed through to the redirect.

**Branch logic** (after validation passes):

1. **Not signed in** (no `req.session.user_id` / however auth is read
   in this codebase): respond `res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl))`.
   Login page (ticket 009) sends the user back here after success.
2. **Signed in, consent on file** (`oauthConsents.find` returns a row):
   mint a code via `oauthCodes.mint` (ticket 003) using the validated
   `redirect_uri`, the intersected scopes, and the supplied
   `code_challenge` / `code_challenge_method`. Redirect to
   `redirect_uri?code=<code>&state=<state>` (preserve any existing
   query string on `redirect_uri` by URL-building, not string concat).
3. **Signed in, no consent**: redirect to the client-side consent page:
   `res.redirect(302, '/oauth/consent?' + queryString)` where the
   queryString round-trips `client_id`, `redirect_uri`, `scope`,
   `state`, `code_challenge`, `code_challenge_method`. Ticket 010
   builds the page that reads these.

Audit event `oauth_authorize_attempt` on every request (actor =
`user_id` if known, else null; metadata = `{ oauth_client_id, scopes,
outcome }` where outcome is one of `redirect_to_login`,
`redirect_with_code`, `prompt_consent`, `error`).

## Acceptance Criteria

- [x] `GET /oauth/authorize` mounted in `server/src/routes/oauth.ts`.
- [x] All required query params are validated; missing/invalid params return 400 with OAuth-spec error names.
- [x] Unknown / disabled client → 401 `invalid_client` (rendered, not redirected).
- [x] `redirect_uri` not matching `client.redirect_uris` (via `matchesRedirectUri`) → 400 `invalid_request` rendered.
- [x] Unauthenticated → 302 to `/login?next=<encoded full authorize URL>`.
- [x] Authenticated + consent-on-file → 302 to `redirect_uri?code=...&state=...`; code is single-use.
- [x] Authenticated + no consent → 302 to `/oauth/consent?...` with all round-trip params.
- [x] `oauth-consent.service.ts` exists and `find` returns a hit only when stored scopes are a superset of requested.
- [x] Audit event `oauth_authorize_attempt` written with the right outcome.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: extend `server/src/routes/oauth.test.ts`:
  - Unauthenticated → 302 `/login?next=...`; `next` URL-decodes back to the original authorize URL.
  - Authenticated + no consent → 302 `/oauth/consent?...`.
  - Authenticated + consent-on-file → 302 `redirect_uri?code=...&state=...`; code consumes successfully on `/oauth/token` (smoke between this ticket and ticket 007).
  - Missing `code_challenge` → 400 `invalid_request`.
  - `code_challenge_method=plain` → 400 `invalid_request`.
  - Unknown `client_id` → 401 `invalid_client`.
  - Disabled client → 401 `invalid_client`.
  - Disallowed `redirect_uri` → 400 `invalid_request`.
  - Localhost-any-port: registered `http://localhost:8080/cb`, candidate `http://localhost:5555/cb` → succeeds.
  - Empty scope intersection → 400 `invalid_scope`.
  - Audit event written with the right outcome value for each branch.
  - Consent-superset: store consent for `[profile, users:read]`, request `[profile]` → consent skipped (mints code).
  - Consent-subset: store consent for `[profile]`, request `[profile, users:read]` → consent prompted.
- **Verification command**: `npm run test:server -- oauth`
