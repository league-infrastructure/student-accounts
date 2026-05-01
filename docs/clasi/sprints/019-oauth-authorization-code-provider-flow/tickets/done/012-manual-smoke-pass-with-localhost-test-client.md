---
id: '012'
title: Manual smoke pass with localhost test client
status: done
use-cases:
- SUC-019-001
- SUC-019-002
- SUC-019-003
- SUC-019-004
depends-on:
- '001'
- '002'
- '003'
- '004'
- '005'
- '006'
- '007'
- 008
- 009
- '010'
- '011'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke pass with localhost test client

## Description

Stakeholder-driven manual smoke test. Sprint 019 makes this app a
real OAuth identity provider; before close we verify the end-to-end
human flow against the running dev stack. The CLASI process keeps
sprints OPEN after execution so this pass is run by hand. See
`sprint.md` § Success Criteria for the items being validated.

**Setup:**

1. Boot the dev stack: `npm run dev` (or `rundbat up dev` if the
   project uses rundbat for dev DB; check the existing dev
   instructions in `docs/`).
2. Sign in to the admin UI as the stakeholder's user.
3. Create a new OAuth client via Admin → OAuth Clients:
   - Name: `Smoke Test Client`
   - Description: `Sprint 019 smoke test`
   - Redirect URIs: `http://localhost:9999/cb` (note: port 9999, NOT
     the test client's actual port — this is the localhost-any-port
     check)
   - Allowed scopes: `profile users:read`
   - Capture the secret from the once-only modal.
4. Run the bash test client from
   `docs/oauth-provider.md` (ticket 011) on `localhost:5555` (third,
   distinct port). The script must be parameterised so the redirect
   URI passed to `/authorize` is `http://localhost:5555/cb` (its own
   port, NOT the registered 9999) — this is what exercises
   SUC-019-004.

**Smoke checklist** — each item must pass:

- [ ] **SUC-019-001 happy path:** authorize → consent screen renders with the test client's name/description and `profile`+`users:read` chips → click Allow → browser redirects to `http://localhost:5555/cb?code=...&state=...` → script exchanges the code for `{ access_token, refresh_token, ... }` → script calls `/oauth/userinfo` and prints the stakeholder's identity.
- [ ] **SUC-019-004 localhost-any-port:** the registered URI was `http://localhost:9999/cb` but the flow used `http://localhost:5555/cb`; the redirect-matcher accepted it. Try again with `http://localhost:5555/different` and confirm the server returns 400 (path mismatch).
- [ ] **State round-trip:** the `state` parameter the script sends is exactly what comes back on the redirect.
- [ ] **PKCE mismatch:** edit the script to send the wrong `code_verifier` to `/oauth/token`. Confirm 400 `invalid_grant`.
- [ ] **Code replay:** complete the flow once, then attempt to exchange the same code again. Confirm 400 `invalid_grant`.
- [ ] **SUC-019-002 deny path:** restart the script (or use a fresh authorize URL), click Deny on the consent screen. Browser redirects to `http://localhost:5555/cb?error=access_denied&state=...`. No `OAuthAuthorizationCode` row exists; no `OAuthConsent` row exists.
- [ ] **Consent persistence:** restart the script, run authorize again — the consent screen is SKIPPED and a code is minted directly (`OAuthConsent` row from the prior allow is hit).
- [ ] **SUC-019-003 refresh rotation:** script rotates its refresh token; new tokens come back. Then attempt to rotate the OLD refresh token again — confirm 400 `invalid_grant` AND that ALL rows in the chain have `revoked_at` set (verify via `sqlite3 dev.db "select id, revoked_at, replaced_by_id from OAuthRefreshToken;"`).
- [ ] **Disabled client:** in the admin UI, disable the test client. Re-run the script. Confirm authorize returns 401 `invalid_client` and any held refresh-rotation attempt also returns 401.
- [ ] **Audit events:** query the audit-events table and confirm rows exist for `oauth_authorize_attempt`, `oauth_consent_granted`, `oauth_consent_denied`, `oauth_code_issued`, `oauth_code_consumed`, `oauth_refresh_minted`, `oauth_refresh_rotated`, `oauth_refresh_reuse_detected`, `oauth_userinfo_call`.
- [ ] **Login `next=` redirect:** sign out, then paste the authorize URL into a fresh browser tab. Confirm redirect to `/login?next=...`. Sign in. Confirm browser returns to the authorize URL (and on through to consent / code).
- [ ] **Open-redirect block:** paste `http://localhost:5201/login?next=//evil.com` into the browser, sign in, confirm the page lands at `/account` (NOT `evil.com`).

When every item is checked, comment in the sprint with confirmation
and proceed to `close_sprint`.

## Acceptance Criteria

- [ ] Every checklist item above is checked off.
- [ ] Any failures are recorded as new TODOs (or new tickets in this sprint) and resolved before close.

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client` (final green-bar before close).
- **New tests to write**: None (this ticket is the manual pass; automated coverage lives in tickets 002–010).
- **Verification command**: `npm run test:server && npm run test:client && bash docs/oauth-provider/test-client.sh`
