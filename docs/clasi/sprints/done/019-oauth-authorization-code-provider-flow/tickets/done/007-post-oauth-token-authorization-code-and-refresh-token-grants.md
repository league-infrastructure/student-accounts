---
id: '007'
title: POST /oauth/token authorization-code and refresh-token grants
status: done
use-cases:
- SUC-019-001
- SUC-019-003
depends-on:
- '003'
- '004'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# POST /oauth/token authorization-code and refresh-token grants

## Description

Extend the existing `POST /oauth/token` handler in
`server/src/routes/oauth.ts` (sprint 018 ticket 003) to support two
new `grant_type` values per `architecture-update.md` § "Modified
Modules (Server)" and `sprint.md` § Solution step 4. The
`client_credentials` grant from sprint 018 stays unchanged; this
ticket only adds branches.

Reuse the credential-extraction logic from sprint 018 (HTTP Basic
header OR `client_id` / `client_secret` form fields). Verify the
client via the existing `oauthClients.verifySecret` and reject
unknown / wrong-secret / disabled clients with 401 `invalid_client`.

**Branch on `grant_type`:**

### `grant_type=authorization_code`

Required fields: `code`, `redirect_uri`, `code_verifier`. Missing any
→ 400 `invalid_request`.

1. Call `oauthCodes.consume({ code, redirect_uri, code_verifier })`
   (ticket 003). The service validates expiry, single-use,
   `redirect_uri` exact match, and PKCE S256. On any `OAuthError`,
   map to HTTP 400 with the OAuth-spec error name.
2. Cross-check: the consumed code's `oauth_client_id` must equal the
   authenticated client's id. Mismatch → 400 `invalid_grant` (a
   client trying to spend another client's code).
3. Mint an access token via the existing `oauthTokens.issue` (sprint
   018) with `user_id = code.user_id` and `scopes = code.scopes`.
4. Mint a refresh token via `oauthRefreshTokens.mint` (ticket 004) with
   the same `client_id`, `user_id`, `scopes`.
5. Respond:
   ```json
   {
     "access_token": "<plaintext>",
     "token_type": "Bearer",
     "expires_in": 3600,
     "refresh_token": "<plaintext>",
     "scope": "profile users:read"
   }
   ```

### `grant_type=refresh_token`

Required fields: `refresh_token`. Missing → 400 `invalid_request`.

1. Call `oauthRefreshTokens.rotate({ token: refresh_token })` (ticket
   004). The service validates expiry, revocation, reuse-detection,
   and disabled-client.
2. Cross-check: the loaded refresh token's `oauth_client_id` must
   equal the authenticated client's id (a client trying to rotate
   another client's refresh token must fail) → 400 `invalid_grant`.
3. Map `OAuthError` codes: `invalid_client` → 401, others → 400.
4. Respond with the same shape as the authorization-code branch
   (using the new access + refresh tokens from `rotate`).

### Unknown grant_type

Return 400 `{ error: 'unsupported_grant_type' }` per OAuth-spec.
(Sprint 018 already handles this for non-`client_credentials`; the
switch grows to cover the two new values without changing the default
branch.)

### Disabled client

Reject ALL grants (including `client_credentials` — already enforced
by sprint 018) when `disabled_at !== null`. Already handled centrally
via `oauthClients.verifySecret`; verify no regression.

Audit events: rely on the services' existing audits
(`oauth_token_issued`, `oauth_code_consumed`, `oauth_refresh_minted`,
`oauth_refresh_rotated`, `oauth_refresh_reuse_detected`). The route
itself does not need to emit additional events.

## Acceptance Criteria

- [x] `POST /oauth/token` with `grant_type=authorization_code` returns the documented response shape with both access and refresh tokens.
- [x] PKCE verifier mismatch → 400 `invalid_grant`.
- [x] Replayed code → 400 `invalid_grant`.
- [x] Mismatched `redirect_uri` between authorize and token → 400 `invalid_grant`.
- [x] Code from one client spent by a different authenticated client → 400 `invalid_grant` (cross-client check in route).
- [x] `grant_type=refresh_token` happy path returns rotated access + refresh tokens.
- [x] Replayed refresh token → 400 `invalid_grant` AND entire chain is revoked (assert via DB read).
- [x] Refresh token from disabled client → 401 `invalid_client`.
- [x] Refresh token rotated by a different client → 400 `invalid_grant` (verifySecret fails for wrong client).
- [x] Missing required fields → 400 `invalid_request`.
- [x] Unknown `grant_type` → 400 `unsupported_grant_type`.
- [x] `client_credentials` grant from sprint 018 still works unchanged.

## Testing

- **Existing tests to run**: `npm run test:server` (must include the existing sprint-018 tests for `client_credentials`).
- **New tests to write**: extend `server/src/routes/oauth.test.ts` covering every bullet above. Concretely:
  - Full SUC-019-001 round trip: build PKCE pair in the test, mint code via `oauthCodes.mint`, hit `/oauth/token` with `grant_type=authorization_code`, assert response shape and that both tokens validate against the DB hashes.
  - Full SUC-019-003 round trip: rotate a refresh token, then attempt to rotate the same original token again — assert chain revocation in DB.
  - Each negative case enumerated above.
- **Verification command**: `npm run test:server -- oauth`
