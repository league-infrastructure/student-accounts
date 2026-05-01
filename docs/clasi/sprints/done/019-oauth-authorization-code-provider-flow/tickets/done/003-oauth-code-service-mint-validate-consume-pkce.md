---
id: '003'
title: OAuth code service mint validate consume PKCE
status: done
use-cases:
- SUC-019-001
depends-on:
- '001'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# OAuth code service mint validate consume PKCE

## Description

Create `server/src/services/oauth/oauth-code.service.ts` (registered in
`server/src/services/service.registry.ts` as `oauthCodes`) per
`architecture-update.md` § "New Modules (Server)". Mirrors the hashing
pattern already used in `server/src/services/oauth/oauth-token.service.ts`
(sprint 018) — plaintext returned once, only SHA-256 hash persisted.

**API:**

```ts
mint(args: {
  client_id: number;
  user_id: number;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  code_challenge_method: 'S256';
}): Promise<{ code: string }>;

consume(args: {
  code: string;
  redirect_uri: string;
  code_verifier: string;
}): Promise<OAuthAuthorizationCode>; // throws OAuthError otherwise
```

**`mint`** generates a high-entropy plaintext (32 bytes, base64url, no
padding — same generator as the access-token service), SHA-256-hashes
it, stores the row in `OAuthAuthorizationCode` with `expires_at = now +
10 min`, `scopes` as Json, the supplied `redirect_uri`,
`code_challenge`, `code_challenge_method` (must be `'S256'` — reject
`'plain'` and any other value with `OAuthError('invalid_request')`),
and returns the plaintext code (only opportunity for the caller to see
it). Writes audit event `oauth_code_issued` (actor = `user_id`,
metadata `{ oauth_client_id, scopes }`).

**`consume`** must be atomic against double-spend:

1. Hash the supplied `code` (SHA-256, base64url-no-pad — match `mint`).
2. In a single Prisma transaction: look up the row by `code_hash`;
   throw `OAuthError('invalid_grant')` if not found, expired
   (`expires_at < now`), or already consumed (`consumed_at !== null`).
3. Verify `redirect_uri` argument exactly equals the stored
   `redirect_uri`; mismatch → `OAuthError('invalid_grant')`.
4. PKCE S256 verification (RFC 7636 §4.6): SHA-256 the `code_verifier`
   bytes, base64url-encode without padding, compare to the stored
   `code_challenge`. Mismatch → `OAuthError('invalid_grant')`.
5. Update the row setting `consumed_at = now` with a `where` clause that
   includes `consumed_at: null` so two concurrent consumes have a
   single winner (the loser sees count=0 and throws `invalid_grant`).
6. Return the loaded row (including `user_id`, `oauth_client_id`,
   `scopes`).

Audit event `oauth_code_consumed` on success. PKCE off-by-one is the
classic bug here — write tests using RFC 7636 Appendix B test vectors
(verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` →
challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`).

`OAuthError` should be a small class with a `.code` matching OAuth-spec
error names (`invalid_request`, `invalid_grant`) so the `/oauth/token`
route (ticket 007) can map to the right HTTP status. If a similar
error type already exists from sprint 018, reuse it.

## Acceptance Criteria

- [x] `server/src/services/oauth/oauth-code.service.ts` exists, registered as `oauthCodes` in `service.registry.ts`.
- [x] `mint` returns plaintext once; only SHA-256 hash is persisted (`code_hash` column).
- [x] `mint` rejects `code_challenge_method !== 'S256'` with `invalid_request`.
- [x] `consume` is single-use enforced atomically (transactional `update` with `consumed_at: null` predicate).
- [x] `consume` validates expiry, `redirect_uri` exact match, and PKCE S256 verifier.
- [x] All failure paths throw `OAuthError` with OAuth-spec error codes.
- [x] Audit events `oauth_code_issued` and `oauth_code_consumed` are written.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `server/src/services/oauth/oauth-code.service.test.ts`:
  - Mint then consume happy path with RFC 7636 Appendix B test vector.
  - Replay (consume the same code twice) → second call throws `invalid_grant`.
  - Expired code → `invalid_grant`.
  - Wrong `code_verifier` → `invalid_grant`.
  - Mismatched `redirect_uri` between mint and consume → `invalid_grant`.
  - Mint with `code_challenge_method='plain'` → `invalid_request`.
  - Concurrent consume race (two `consume()` calls with the same code in parallel) → exactly one resolves, the other throws `invalid_grant`.
  - Hash storage check: read the row directly, confirm `code_hash !== plaintext`.
  - Audit events written with the right actions and metadata.
- **Verification command**: `npm run test:server -- oauth-code.service`
