---
sprint: "019"
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Architecture Update — Sprint 019: OAuth Authorization-Code Provider Flow

## What Changed

### Schema (Prisma)

| Model | Change |
|---|---|
| `OAuthAuthorizationCode` (new) | `id`, `code_hash` (SHA-256, unique), `oauth_client_id` FK, `user_id` FK, `redirect_uri` String, `scopes` Json (string[]), `code_challenge` String, `code_challenge_method` String (`S256` only), `expires_at` DateTime, `consumed_at` DateTime?, `created_at`. Cascade delete with client. Index on `oauth_client_id`. |
| `OAuthRefreshToken` (new) | `id`, `token_hash` String (SHA-256, unique), `oauth_client_id` FK, `user_id` FK, `scopes` Json, `expires_at` DateTime, `revoked_at` DateTime?, `replaced_by_id` Int? (FK to self), `created_at`, `last_used_at` DateTime?. Cascade delete with client. Index on `oauth_client_id`. |
| `OAuthConsent` (new) | `id`, `user_id` FK, `oauth_client_id` FK, `scopes` Json (string[]), `granted_at`, unique on `(user_id, oauth_client_id)` (we replace the row on re-consent rather than maintaining history). Cascade delete with client AND with user. |

### New Modules (Server)

| Module | Purpose |
|---|---|
| `server/src/services/oauth/redirect-matcher.ts` | Pure function `matchesRedirectUri(registered: string[], candidate: string): boolean`. Exact match OR localhost-any-port match. No I/O. Unit-tested in isolation. |
| `server/src/services/oauth/oauth-code.service.ts` | `mint({ client_id, user_id, redirect_uri, scopes, code_challenge, code_challenge_method }) → { code }` (plaintext returned once); `consume({ code, redirect_uri, code_verifier }) → AuthorizationCode | throws`. Validates expiry, single-use, PKCE (S256 hash compare). |
| `server/src/services/oauth/oauth-refresh.service.ts` | `mint({ client_id, user_id, scopes }) → { token }`; `rotate({ token }) → { newToken, accessToken }`; reuse detection — if a previously-rotated token is presented, revoke the entire chain (`replaced_by_id` walk). |
| `server/src/services/oauth/oauth-consent.service.ts` | `find({ user_id, client_id, scopes }) → OAuthConsent | null` (matches if existing consent's scopes ⊇ requested scopes); `record({ user_id, client_id, scopes })` (upserts unique row). |

### Modified Modules (Server)

| Module | Change |
|---|---|
| `server/src/routes/oauth.ts` | Add `GET /authorize`, `POST /authorize/consent`, extend `POST /token` with `authorization_code` and `refresh_token` grants, add `GET /userinfo`. |
| `server/src/services/oauth/oauth-token.service.ts` (sprint 018) | Extend `issue` to accept `user_id` (already nullable in schema; becomes meaningful for authorization-code). |
| `server/src/services/service.registry.ts` | Register the new services. |
| `server/src/routes/auth/login.ts` (or wherever the login endpoint lives) | Honor `next` query param on POST: if `next` is a same-origin path, redirect there after successful login. Reject cross-origin `next`. |

### New Modules (Client)

| Module | Purpose |
|---|---|
| `client/src/pages/OAuthConsent.tsx` | Consent screen. Shows requesting client + scopes; Allow/Deny buttons POST to `/oauth/authorize/consent`. |

### Modified Modules (Client)

| Module | Change |
|---|---|
| `client/src/pages/Login.tsx` | Honor `?next=...` on the URL: after successful login, set `window.location` to the next-path (validated same-origin) instead of `/account`. |
| `client/src/pages/admin/OAuthClients.tsx` (sprint 018) | Redirect-URIs editor improvements (multi-line input, localhost-pattern hint). |

### New Documentation

`docs/oauth-provider.md` — integrator guide. Includes a working `curl`-based
test-client script to verify the full flow against a local dev instance.

## Why

The TODO `plan-single-sign-on-oauth-provider-migration.md` (Sprint 4)
calls for the user-facing OAuth flow that completes this app's
transformation into the League's identity service. PKCE is mandatory
modern best practice and our default for native + SPA clients.
Localhost-any-port is a developer-experience requirement called out
explicitly in the plan.

## Impact on Existing Components

- **Login flow gains a `next=` redirect parameter** — minimal risk, well-trodden pattern. Same-origin enforcement is the security gate.
- **`/oauth/token` becomes a multi-grant endpoint.** The grant_type switch must be exhaustive; an unknown grant_type returns OAuth-spec `unsupported_grant_type`.
- **`oauthBearer` middleware (sprint 018) is reused** for `/oauth/userinfo`. No changes.
- **Audit logging** extends with new actions: `oauth_authorize_attempt`, `oauth_consent_granted`, `oauth_consent_denied`, `oauth_code_issued`, `oauth_code_consumed`, `oauth_refresh_rotated`, `oauth_refresh_reuse_detected` (security event), `oauth_userinfo_call`.

## Migration Concerns

- `prisma db push --accept-data-loss --schema=prisma/schema.prisma` against dev SQLite. Pure additive.
- Production: `prisma migrate deploy` at deploy time (not in scope).
- No backfill — these models start empty.

## Risks

- **PKCE verification correctness.** SHA-256 the verifier, base64url-encode (no padding), compare to the stored challenge. Off-by-one on encoding is the classic bug. Unit-test with known RFC 7636 test vectors.
- **Same-origin `next=` validation.** The Login page must reject cross-origin redirects (open-redirect bug). Test explicit attack vectors: scheme-relative `//evil.com`, absolute `https://evil.com`, embedded null bytes.
- **Refresh-token reuse detection.** If we don't revoke the chain on replay, a stolen old token + a replay race lets the attacker mint a new chain. Detect and revoke on first replay.
- **Localhost-any-port matcher.** Don't accidentally match `http://localhostfake.com` — the matcher must compare the full host (`localhost`, `127.0.0.1`, or `[::1]`), not a substring.
- **Authorization code single-use.** Database-level uniqueness on `code_hash` plus `consumed_at` check inside a transaction. Two concurrent token requests with the same code: one wins, the other gets `invalid_grant`.
