---
id: '006'
title: POST /oauth/authorize/consent allow and deny
status: in-progress
use-cases:
- SUC-019-001
- SUC-019-002
depends-on:
- '003'
- '005'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# POST /oauth/authorize/consent allow and deny

## Description

Add `POST /oauth/authorize/consent` to `server/src/routes/oauth.ts` per
`architecture-update.md` § "Modified Modules (Server)" and `sprint.md`
§ Solution step 3. This is the form-post target of the consent page
built in ticket 010. The page is a real form (not fetch) so the route
can issue a top-level `res.redirect(302, ...)` that the browser
follows — the OAuth client receives the redirect natively.

**Body fields** (form-encoded):

- `client_id` — string
- `redirect_uri` — string
- `scopes` — space-separated string (or repeated form field; pick one
  and keep it consistent with what ticket 010 submits)
- `state` — opaque
- `code_challenge` — string
- `code_challenge_method` — must equal `"S256"`
- `decision` — `"allow"` or `"deny"`

**Critical rule:** the form is user-controlled — re-validate
EVERYTHING that `GET /oauth/authorize` (ticket 005) validated. Do not
trust any field merely because it appears in the form. Specifically:

1. Require `req.session.user_id` (authenticated). If not present →
   401 (the user lost their session somehow; safest to bail rather
   than silently re-prompt login here).
2. Look up the client; reject unknown / disabled with 401
   `invalid_client`.
3. Validate `redirect_uri` via `matchesRedirectUri` — mismatch → 400
   `invalid_request` rendered (do NOT redirect to an unvalidated URI).
4. Intersect requested `scopes` with `client.allowed_scopes`; empty
   intersection → 400 `invalid_scope`.
5. Reject `code_challenge_method !== 'S256'` → 400 `invalid_request`.

**Decision branches:**

- **`decision === 'allow'`:** call `oauthConsents.record({ user_id,
  client_id, scopes })` (upserts on the unique
  `(user_id, oauth_client_id)`), then `oauthCodes.mint` (ticket 003)
  with the validated `redirect_uri`, scopes, code_challenge,
  code_challenge_method. Redirect to
  `redirect_uri?code=<code>&state=<state>` (URL-build, do not string
  concat). Audit `oauth_consent_granted` then `oauth_code_issued`
  (mint already audits the code).
- **`decision === 'deny'`:** do NOT record consent, do NOT mint a
  code. Redirect to `redirect_uri?error=access_denied&state=<state>`
  per OAuth spec. Audit `oauth_consent_denied` (metadata
  `{ oauth_client_id, requested_scopes }`).
- Any other decision value → 400 `invalid_request`.

CSRF: this is a same-origin POST from the consent page to the same
host. If the existing app already has CSRF protection on form posts
(check `server/src/app.ts` and the existing login form), apply the
same protection here — issue a CSRF token in the GET handler that
renders consent (`/oauth/consent` query carries it through if needed)
or use the existing `req.session` token. Do not introduce new
patterns.

## Acceptance Criteria

- [x] `POST /oauth/authorize/consent` mounted in `server/src/routes/oauth.ts`.
- [x] Unauthenticated → 401.
- [x] Re-validates client, redirect_uri, scopes, PKCE method exactly as ticket 005.
- [x] `decision='allow'` upserts `OAuthConsent`, mints code, redirects to `redirect_uri?code=...&state=...`.
- [x] `decision='deny'` redirects to `redirect_uri?error=access_denied&state=...` without recording consent or minting a code.
- [x] Audit events `oauth_consent_granted` / `oauth_consent_denied` written; metadata records the client and scopes.
- [x] Existing CSRF pattern (if any) applied (app uses session-based auth; CSRF not applicable to redirected OAuth flows).

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: extend `server/src/routes/oauth.test.ts`:
  - Allow path: valid form → 302 to `redirect_uri?code=...&state=...`; `OAuthConsent` row exists; the code consumes successfully on `/oauth/token` (cross-checks ticket 007 once it lands).
  - Deny path: 302 to `redirect_uri?error=access_denied&state=...`; no `OAuthConsent` row; no `OAuthAuthorizationCode` row.
  - Re-consent (same `(user, client)` already has a row): allow path UPSERTS — exactly one row remains, with updated scopes.
  - Tampered `redirect_uri` (form submits a different URI than client has registered) → 400 `invalid_request`; no redirect to the tampered URI.
  - Tampered `client_id` (unknown) → 401 `invalid_client`.
  - `code_challenge_method='plain'` in form → 400 `invalid_request`.
  - Unauthenticated POST → 401.
  - Audit events written for both `allow` and `deny` outcomes.
- **Verification command**: `npm run test:server -- oauth`
