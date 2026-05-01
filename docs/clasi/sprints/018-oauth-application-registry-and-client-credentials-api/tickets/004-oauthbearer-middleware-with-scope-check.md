---
id: "004"
title: "oauthBearer middleware with scope check"
status: todo
use-cases: [SUC-018-003]
depends-on: ["003"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# oauthBearer middleware with scope check

## Description

Create `server/src/middleware/oauthBearer.ts`. This middleware is the
authoritative gate for every OAuth-token-protected route in the app —
this sprint protects `/v1/users*`, sprint 019 will reuse it for
`/oauth/userinfo`. The architecture-update.md "Risks" section calls out
that this surface must be airtight, so the implementation must be
small, focused, and well-tested.

Factory signature:

```ts
oauthBearer(requiredScope?: string): RequestHandler
```

Behavior:

1. Read the bearer token from `Authorization: Bearer <token>`. As an
   optional fallback per RFC 6750 §2.3, accept `?access_token=` query
   param. If neither is present → 401 with OAuth-spec error
   `{ error: 'invalid_token', error_description: '...' }`.
2. SHA-256-hash the incoming plaintext and look up the matching
   `OAuthAccessToken` row (single indexed query on `token_hash`).
3. Reject if any of the following — return 401 `invalid_token`:
   - Row not found.
   - `expires_at <= now`.
   - `revoked_at !== null`.
   - The owning `OAuthClient.disabled_at !== null`.
4. If `requiredScope` is provided and the token's `scopes` array does
   not include it → return 403 with `{ error: 'insufficient_scope', scope: requiredScope }`.
5. On success: best-effort update `last_used_at = now()` (do not block
   the request on the write — fire-and-forget is acceptable, but log
   any error). Attach `req.oauth = { client_id, user_id, scopes }`
   (extend the Express `Request` typing in a `.d.ts` if needed). Call
   `next()`.

Constant-time compares are unnecessary here because we look up by hash
(no timing leak on the secret); the security boundary is the hash, not
a comparator.

## Acceptance Criteria

- [ ] `server/src/middleware/oauthBearer.ts` exists and exports `oauthBearer(requiredScope?)`.
- [ ] Missing token → 401 `invalid_token`.
- [ ] Unknown / expired / revoked token → 401 `invalid_token`.
- [ ] Token belonging to a disabled client → 401 `invalid_token`.
- [ ] Scope mismatch → 403 `insufficient_scope`.
- [ ] On success `req.oauth` is populated and `last_used_at` is updated.
- [ ] Type augmentation for `Request.oauth` lives in a `.d.ts` referenced from the server `tsconfig`.
- [ ] No regressions in existing server tests.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `server/src/middleware/oauthBearer.test.ts` — table-driven cases: missing header, malformed header, unknown token, expired token, revoked token, disabled client, scope match, scope mismatch, successful path verifies `req.oauth` shape and `last_used_at` is advanced.
- **Verification command**: `npm run test:server`
