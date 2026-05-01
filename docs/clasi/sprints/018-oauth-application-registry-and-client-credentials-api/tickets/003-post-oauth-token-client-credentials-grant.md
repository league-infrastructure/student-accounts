---
id: "003"
title: "POST /oauth/token client-credentials grant"
status: todo
use-cases: [SUC-018-002]
depends-on: ["002"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# POST /oauth/token client-credentials grant

## Description

Create `server/src/routes/oauth.ts` and mount it at `/oauth` (NOT
`/api/oauth`) in `server/src/app.ts`. External clients are not internal
API consumers, so they live at the bare `/oauth` namespace per
`architecture-update.md` "New Modules (Server)".

Single endpoint this sprint: `POST /oauth/token`. Only
`grant_type=client_credentials` is accepted; any other grant returns the
OAuth-spec error `{ error: 'unsupported_grant_type' }` with status 400.

Credentials may be provided two ways (RFC 6749 §2.3.1):
- HTTP Basic auth header: `Authorization: Basic base64(client_id:secret)`
- Form fields `client_id` and `client_secret` in the request body.

Validate via `oauthClients.verifySecret(client_id, secret)` from ticket
002. On failure (unknown client, wrong secret, disabled client) return
401 `{ error: 'invalid_client' }`.

Add a companion service
`server/src/services/oauth/oauth-token.service.ts` (registered in
`service.registry.ts` as `oauthTokens`) responsible for issuing tokens.
For client-credentials it creates an `OAuthAccessToken` with:

- `oauth_client_id` from the verified client
- `user_id = null`
- `scopes` = the requested scopes (from `scope` form field, space-separated) intersected with the client's `allowed_scopes`. If `scope` is omitted, default to the client's full `allowed_scopes`.
- `expires_at` = now + 1 hour
- `token_hash` = SHA-256 of a freshly generated high-entropy plaintext (mirror llm-proxy hashing)

Response (per OAuth spec):

```
{ "access_token": "<plaintext>", "token_type": "Bearer", "expires_in": 3600, "scope": "users:read ..." }
```

Write an `AuditEvent` with action `oauth_token_issued` (actor = null,
metadata = `{ oauth_client_id, scopes }`).

## Acceptance Criteria

- [ ] `server/src/routes/oauth.ts` exists and is mounted at `/oauth` in `app.ts`.
- [ ] `POST /oauth/token` accepts both Basic-auth and form-field credentials.
- [ ] `grant_type` other than `client_credentials` → 400 with `unsupported_grant_type`.
- [ ] Unknown client / wrong secret / disabled client → 401 with `invalid_client`.
- [ ] Successful response shape matches the OAuth-spec example above; `expires_in` is 3600 (configurable constant ok).
- [ ] Requested scopes are intersected with the client's `allowed_scopes`; an empty intersection → 400 `invalid_scope`.
- [ ] `OAuthAccessToken` row is created with the SHA-256 hash; plaintext never persisted.
- [ ] `oauth_token_issued` audit event is written on success.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `server/src/routes/oauth.test.ts` — happy path (Basic auth and form-field flavors), wrong grant type, wrong secret, disabled client, scope intersection (request narrower than allowed, request broader → narrowed to allowed, request disjoint → 400), audit event written.
  - `server/src/services/oauth/oauth-token.service.test.ts` — token creation, hash storage, expiry math.
- **Verification command**: `npm run test:server`
