---
id: "002"
title: "OAuthClient service create rotate disable"
status: todo
use-cases: [SUC-018-001, SUC-018-004]
depends-on: ["001"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# OAuthClient service create rotate disable

## Description

Create the service module that owns the `OAuthClient` lifecycle:
`server/src/services/oauth/oauth-client.service.ts`. This is the single
place where client secrets are generated, hashed, and verified. Admin
routes (ticket 006) and the `/oauth/token` endpoint (ticket 003) will
both consume this service.

Mirror the SHA-256 hashing pattern in `server/src/services/llm-proxy/` —
do NOT invent a new scheme. Look at the existing token hashing helpers
there for the high-entropy generation, hex/base64 encoding choice, and
the constant-time compare utility. Reuse if possible; copy-with-rename
if the helpers are not exported. The architecture-update.md "Why /
Impact" section explicitly calls for following one pattern.

Required methods (signatures):

- `create({ name, description?, redirect_uris, allowed_scopes }, actorUserId) → { client, plaintextSecret }`
- `rotateSecret(id, actorUserId) → { plaintextSecret }`
- `disable(id, actorUserId)` — sets `disabled_at = now()`.
- `findByClientId(client_id) → OAuthClient | null`
- `verifySecret(client_id, plaintextSecret) → OAuthClient | null` — constant-time compare; returns the client only when the secret matches AND `disabled_at IS NULL`.

JSON column helpers: provide a small read/write pair so `redirect_uris`
and `allowed_scopes` are exposed to callers as `string[]`, even though
they're persisted as JSON (per ticket 001). Keep these helpers internal
to the service file or a sibling util — they will be reused by the
token service.

Every mutating method (`create`, `rotateSecret`, `disable`) writes an
`AuditEvent` row with the action names listed in
`architecture-update.md` (`oauth_client_created`,
`oauth_client_secret_rotated`, `oauth_client_disabled`) and `actorUserId`
as the actor. Register the service in
`server/src/services/service.registry.ts` as `oauthClients`.

## Acceptance Criteria

- [ ] `server/src/services/oauth/oauth-client.service.ts` exists and exports the five methods above.
- [ ] Client secret generation uses the same entropy/encoding as the LlmProxyToken helper.
- [ ] `client_secret_hash` is SHA-256 of the plaintext; plaintext never persisted.
- [ ] `verifySecret` uses constant-time compare and rejects disabled clients.
- [ ] `create` and `rotateSecret` return plaintext exactly once in the return value; no other code path can recover it.
- [ ] Each mutating method writes an `AuditEvent` (`oauth_client_created`, `oauth_client_secret_rotated`, `oauth_client_disabled`).
- [ ] Service registered in `service.registry.ts`.
- [ ] JSON-array helpers correctly round-trip `string[]` for `redirect_uris` and `allowed_scopes`.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `server/src/services/oauth/oauth-client.service.test.ts` — covers create (returns plaintext + hashed row), rotateSecret (old hash replaced, new plaintext returned), disable (sets `disabled_at`), verifySecret happy path, verifySecret rejects wrong secret, verifySecret rejects disabled client, audit events written for all three mutating methods.
  - Mirror the structure of any existing `llm-proxy` service test in the same repo.
- **Verification command**: `npm run test:server`
