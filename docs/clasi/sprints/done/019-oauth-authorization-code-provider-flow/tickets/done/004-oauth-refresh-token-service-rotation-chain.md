---
id: '004'
title: OAuth refresh-token service rotation chain
status: done
use-cases:
- SUC-019-003
depends-on:
- '001'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# OAuth refresh-token service rotation chain

## Description

Create `server/src/services/oauth/oauth-refresh.service.ts` (registered
in `service.registry.ts` as `oauthRefreshTokens`) per
`architecture-update.md` § "New Modules (Server)". This is the
companion to the access-token service from sprint 018
(`oauth-token.service.ts`), used by the `/oauth/token` route in ticket
007 for both the `authorization_code` and `refresh_token` grants.

**API:**

```ts
mint(args: {
  client_id: number;
  user_id: number;
  scopes: string[];
}): Promise<{ token: string }>; // plaintext, returned once

rotate(args: { token: string }): Promise<{
  refresh_token: string;        // new plaintext refresh token
  access_token: string;         // new plaintext access token (via oauthTokens.issue)
  expires_in: number;           // access-token TTL seconds
  scopes: string[];
}>;
```

**`mint`** generates 32 bytes of entropy, base64url-no-pad. Stores
SHA-256 hash in `OAuthRefreshToken.token_hash`, sets `expires_at = now
+ 30 days`, `scopes` Json, returns plaintext once. Audit
`oauth_refresh_minted`.

**`rotate`** is the security-sensitive path. Per
`architecture-update.md` § Risks "Refresh-token reuse detection":

1. Hash the supplied `token` (SHA-256, base64url-no-pad).
2. Look up the row by `token_hash`. Not found → `OAuthError('invalid_grant')`.
3. Load the associated `OAuthClient`. If `disabled_at !== null` →
   throw `OAuthError('invalid_client')` (HTTP 401 at the route layer).
4. **Reuse detection.** If the row's `replaced_by_id !== null`, this
   token has already been rotated — a replay. Walk the chain (follow
   `replaced_by_id` repeatedly until null OR back to the original by
   walking via `OAuthRefreshToken` linked rows; also walk backwards by
   querying for any rows whose `replaced_by_id` points into the chain)
   and set `revoked_at = now` on EVERY row in the chain in a
   transaction. Write audit event `oauth_refresh_reuse_detected`
   (severity = security) with metadata `{ oauth_client_id, user_id,
   chain_length }`. Throw `OAuthError('invalid_grant')`.
5. If the row is `revoked_at !== null` or `expires_at < now` → throw
   `OAuthError('invalid_grant')`.
6. Otherwise rotate atomically (single transaction): mint a new
   `OAuthRefreshToken` for the same `(oauth_client_id, user_id,
   scopes)`, set the OLD row's `replaced_by_id` to the new row's id,
   set the OLD row's `last_used_at = now`. Then call
   `oauthTokens.issue` (sprint 018) to mint a new access token for the
   same client+user+scopes. Audit `oauth_refresh_rotated`.
7. Return `{ refresh_token, access_token, expires_in, scopes }`.

Note: SUC-019-003 says confidential clients pass `client_id` +
`client_secret` on `/oauth/token` for the refresh grant — that
authentication is handled at the route layer (ticket 007). This
service trusts that the caller has already verified the client and
that the loaded refresh-token row's `oauth_client_id` matches the
authenticated client (the route MUST cross-check this).

## Acceptance Criteria

- [x] `server/src/services/oauth/oauth-refresh.service.ts` exists, registered as `oauthRefreshTokens`.
- [x] `mint` returns plaintext once; only SHA-256 hash persisted.
- [x] `rotate` happy path returns `{ refresh_token, access_token, expires_in, scopes }`; old row's `replaced_by_id` points to new row.
- [x] Replay of an already-rotated token revokes the entire chain (every row's `revoked_at` is set) and throws `invalid_grant`.
- [x] Refresh from a disabled client throws `invalid_client`.
- [x] Expired refresh → `invalid_grant`.
- [x] Revoked refresh → `invalid_grant`.
- [x] Audit events: `oauth_refresh_minted`, `oauth_refresh_rotated`, `oauth_refresh_reuse_detected` written at appropriate points.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `server/src/services/oauth/oauth-refresh.service.test.ts`:
  - Mint → rotate → rotate again happy path; chain length 3, each old row points to its successor.
  - Replay-detect-and-revoke: rotate once, then attempt to rotate the original token again. Verify all 3 rows in the chain (original, second, third) have `revoked_at` set after the replay.
  - Rotate from disabled client → `invalid_client`.
  - Rotate expired refresh → `invalid_grant`.
  - Rotate revoked refresh → `invalid_grant`.
  - Hash storage check: row's `token_hash !== plaintext`.
  - Audit events written.
- **Verification command**: `npm run test:server -- oauth-refresh.service`
