---
id: "008"
title: "GET /oauth/userinfo OIDC-shaped subset"
status: todo
use-cases:
  - SUC-019-001
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GET /oauth/userinfo OIDC-shaped subset

## Description

Add `GET /userinfo` to `server/src/routes/oauth.ts` per
`architecture-update.md` § "Modified Modules (Server)" and `sprint.md`
§ Solution step 5. This is the OIDC-shaped subset endpoint that
external apps call after exchanging an authorization code for an
access token.

Mount behind the existing `oauthBearer('profile')` middleware from
sprint 018 (`server/src/middleware/oauthBearer.ts`). That middleware
already handles:

- 401 if no `Authorization: Bearer ...` header.
- 401 if the token is not found, is expired, or is revoked.
- 403 if the token's scopes do not include `profile`.

Set `req.oauth = { user_id, oauth_client_id, scopes }` (or whatever
shape sprint 018 chose — match it exactly).

**Handler:**

1. If `req.oauth.user_id === null` → 404 (or 400 `invalid_token` —
   pick 404 to match the spec note in the task brief). Tokens minted
   for `client_credentials` (sprint 018) have `user_id = null`; this
   endpoint requires user-context tokens (i.e. minted via
   `authorization_code`).
2. Load the user via `prisma.user.findUnique({ where: { id: req.oauth.user_id } })`.
3. If not found (e.g. user deleted after token minted) → 404.
4. Respond JSON:
   ```json
   {
     "sub": "<String(user.id)>",
     "email": "<user.primary_email>",
     "name": "<user.display_name>",
     "role": "<user.role>"
   }
   ```
   `sub` is the user id stringified per OIDC convention (it's the
   stable subject identifier). Field names match OIDC standard claim
   names where applicable; `role` is our app-specific extension.
5. Audit event `oauth_userinfo_call` (actor = `user_id`, metadata =
   `{ oauth_client_id }`).

Use the actual field names from the existing `User` Prisma model —
verify by reading `prisma/schema.prisma`. If the field is named
`primaryEmail` (camelCase) instead of `primary_email`, use the
generated client name. Do not invent fields.

## Acceptance Criteria

- [ ] `GET /oauth/userinfo` mounted in `server/src/routes/oauth.ts` behind `oauthBearer('profile')`.
- [ ] Returns `{ sub, email, name, role }` for a valid user-context access token with `profile` scope.
- [ ] `sub` is `String(user.id)`.
- [ ] No `Authorization` header → 401.
- [ ] Expired or revoked token → 401.
- [ ] Token without `profile` scope → 403.
- [ ] Token with `user_id = null` (client-credentials) → 404.
- [ ] User has been deleted → 404.
- [ ] Audit event `oauth_userinfo_call` written on success.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: extend `server/src/routes/oauth.test.ts`:
  - Happy path: mint a user-context access token (use `oauthTokens.issue` with `user_id` set, `scopes=['profile']`), call userinfo, assert response shape and `sub` is the stringified id.
  - Missing Authorization header → 401.
  - Expired token → 401 (set `expires_at` in the past directly on the row).
  - Revoked token → 401.
  - Token without `profile` scope (e.g. only `users:read`) → 403.
  - Client-credentials token (`user_id = null`) → 404.
  - User deleted between token mint and userinfo call → 404.
  - Audit event written.
- **Verification command**: `npm run test:server -- oauth`
