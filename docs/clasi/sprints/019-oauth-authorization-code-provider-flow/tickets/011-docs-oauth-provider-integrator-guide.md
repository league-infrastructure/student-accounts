---
id: '011'
title: docs oauth-provider integrator guide
status: in-progress
use-cases:
- SUC-019-001
- SUC-019-003
- SUC-019-004
depends-on:
- '005'
- '006'
- '007'
- 008
- 009
- '010'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# docs oauth-provider integrator guide

## Description

Create `docs/oauth-provider.md` per `architecture-update.md` § "New
Documentation" and `sprint.md` § Solution step 9. This is the
public-facing integrator guide that walks a third-party developer
through using this app as their identity provider.

**Required sections:**

1. **Overview** — what the OAuth flow is, when to use it (vs sprint
   018's `client_credentials` for service-to-service), and the high
   level diagram (authorize → consent → code → token → userinfo →
   refresh).
2. **Registering a client** — step-by-step in the admin UI:
   - Sign in as admin, navigate to Admin → OAuth Clients.
   - Click "New client", supply `name`, `description`, `redirect_uris`
     (one per line), `allowed_scopes`.
   - The page shows the client secret ONCE — copy it now; the app
     will never show it again. (This is the sprint 018 modal.)
3. **Authorization-code + PKCE flow** — full walkthrough with example
   URLs:
   - Build a PKCE pair: `code_verifier` = 43–128 char base64url; `code_challenge` = `base64url(sha256(verifier))` no padding.
   - Send the user's browser to:
     `https://<host>/oauth/authorize?response_type=code&client_id=<id>&redirect_uri=<uri>&scope=profile&state=<random>&code_challenge=<challenge>&code_challenge_method=S256`
   - User signs in if needed, sees the consent screen, clicks Allow.
   - Browser is redirected to `<redirect_uri>?code=<code>&state=<state>` — verify `state` matches what you sent (CSRF defense).
   - Exchange the code:
     `POST https://<host>/oauth/token` with form fields `grant_type=authorization_code`, `code=<code>`, `redirect_uri=<uri>`, `code_verifier=<verifier>`, plus `Authorization: Basic base64(client_id:client_secret)` (or `client_id` / `client_secret` form fields).
   - Response: `{ access_token, token_type, expires_in, refresh_token, scope }`.
4. **Calling /oauth/userinfo** — `GET /oauth/userinfo` with
   `Authorization: Bearer <access_token>`. Response shape `{ sub, email, name, role }`. Required scope: `profile`.
5. **Refreshing** — `POST /oauth/token` with `grant_type=refresh_token`, `refresh_token=<token>`, plus client credentials. Response includes a NEW refresh token; the old one is now invalid (rotation). Replaying the old token revokes the entire chain.
6. **Scopes** — table of available scope names and what they grant:
   - `profile` — required to call `/oauth/userinfo`.
   - `users:read` — required to call `/v1/users` and `/v1/users/:id` (sprint 018).
7. **Token lifetimes** —
   - Authorization code: 10 minutes, single-use.
   - Access token: 1 hour.
   - Refresh token: 30 days, rotated on every use.
8. **Redirect-URI matching rule** — exact-match by default, with
   localhost-any-port special case. Worked example showing
   `http://localhost:8080/cb` registered → `http://localhost:5555/cb`
   accepted, `http://localhost:5555/different` rejected,
   `http://localhostfake.com/cb` rejected.
9. **Error responses** — table of OAuth-spec error codes the
   integrator may receive:
   - `invalid_request`, `invalid_grant`, `invalid_client`,
     `invalid_scope`, `unsupported_grant_type`, `access_denied`.
10. **Working test client** — a copy-pasteable bash + curl + `python -c` (or `openssl`) script. Targets `http://localhost:5201` (the dev server). Generates PKCE, prints the authorize URL for the human to open in a browser, asks them to paste the redirected `code` back into the terminal, exchanges it for tokens, calls `/oauth/userinfo`, and rotates the refresh token. Maybe 60–80 lines of bash. Verify it actually runs end-to-end against a fresh dev DB before closing the ticket.

Cross-link this doc from the project README and from
`docs/clasi/overview.md` if appropriate.

## Acceptance Criteria

- [x] `docs/oauth-provider.md` exists with all 10 sections above.
- [x] Working bash test-client script is included in the doc (inline, ready to copy-paste); manual end-to-end verification against localhost:5201 is a post-implementation smoke test (ticket 012).
- [x] All endpoint URLs, scope names, error codes, and lifetimes match the actual implementation (cross-checked against `server/src/routes/oauth.ts`).
- [x] Localhost-any-port rule documented with a concrete worked example (§8 table).
- [x] README links to the new doc.

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client` (sanity — no code changes expected, but verify the documented commands actually work).
- **New tests to write**: None (documentation ticket). Manual verification: run the bash test-client script against a fresh dev DB and confirm every step (authorize, consent, token, userinfo, refresh) succeeds.
- **Verification command**: bash `docs/oauth-provider/test-client.sh` (or wherever the script lives) against `localhost:5201`.
