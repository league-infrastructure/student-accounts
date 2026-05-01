---
sprint: "018"
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Architecture Update — Sprint 018: OAuth Application Registry and Client-Credentials API

## What Changed

### Schema (Prisma)

| Model | Change |
|---|---|
| `OAuthClient` (new) | `id Int @id`, `client_id String @unique`, `client_secret_hash String`, `name String`, `description String?`, `redirect_uris String[]` (SQLite: stored as JSON column via `Json`), `allowed_scopes String[]` (same), `created_by Int FK → User`, `created_at`, `updated_at`, `disabled_at DateTime?`. Cascade behavior on User delete: SetNull on `created_by`. |
| `OAuthAccessToken` (new) | `id Int @id`, `oauth_client_id Int FK`, `user_id Int? FK` (null for client-credentials), `token_hash String @unique`, `scopes` (Json array), `expires_at DateTime`, `revoked_at DateTime?`, `last_used_at DateTime?`, `created_at`. Cascade: cascade delete with `OAuthClient`. |

SQLite limitation: Prisma's `String[]` requires Postgres. For SQLite we use
`Json` columns and serialize string arrays as JSON. Provide a tiny helper
in the service layer to read/write these as `string[]`.

### New Modules (Server)

| Module | Purpose |
|---|---|
| `server/src/services/oauth/oauth-client.service.ts` | CRUD + secret rotation for OAuthClient. Hashes secrets via SHA-256 (mirrors LlmProxyToken pattern). |
| `server/src/services/oauth/oauth-token.service.ts` | Issue, validate, revoke OAuthAccessToken. SHA-256 hashing, expiry, scope checks. |
| `server/src/middleware/oauthBearer.ts` | Express middleware. Validates `Authorization: Bearer ...`, checks scope, attaches `req.oauth`. |
| `server/src/routes/oauth.ts` | `POST /oauth/token` — client_credentials grant only this sprint. Mounted at `/oauth` (no `/api` prefix — external clients). |
| `server/src/routes/v1-directory.ts` | `GET /v1/users`, `GET /v1/users/:id` — read-only directory API behind `oauthBearer('users:read')`. Mounted at `/v1`. |
| `server/src/routes/admin/oauth-clients.ts` | Admin CRUD for OAuth clients. Mounted under existing `/api/admin`. |

### New Modules (Client)

| Module | Purpose |
|---|---|
| `client/src/pages/admin/OAuthClients.tsx` | Admin page: list, create, rotate, disable. Reachable from User Management sub-app. |
| `client/src/components/SecretShownOnceModal.tsx` (or extracted from LlmProxyToken UI if a similar one exists) | Modal that displays a freshly-minted secret with copy-to-clipboard and clear "you won't see this again" warning. |

### Modified Modules

| Module | Change |
|---|---|
| `server/src/services/service.registry.ts` | Register `oauthClients` and `oauthTokens` services. |
| `server/src/app.ts` | Mount `oauthRouter` at `/oauth`, `v1DirectoryRouter` at `/v1`, `adminOAuthClientsRouter` under `/api/admin`. |
| `server/src/services/app-tiles.service.ts` | Add an OAuth-Clients admin tile (admin-only) so the new page is reachable from `/account`. |

## Why

The TODO `plan-single-sign-on-oauth-provider-migration.md` (Sprint 3) calls
for an OAuth provider that issues tokens to registered third-party clients.
Sprint 018 ships the simpler half — client-credentials grant + read-only
directory API — to prove the token plumbing before sprint 019 adds the
authorization-code flow with PKCE.

## Impact on Existing Components

- The new schema is additive — existing tables unchanged.
- The existing `LlmProxyToken` patterns (SHA-256 hashing, plaintext-once
  UX) are reused conceptually; no code shared, but the implementation
  follows the same shape so future maintainers see one pattern.
- A new tile appears on the admin Account page (Sprint 016 tile catalog
  is extended).
- Audit logging extends the existing `AuditEvent` model with new actions:
  `oauth_client_created`, `oauth_client_secret_rotated`,
  `oauth_client_disabled`, `oauth_token_issued`, `oauth_directory_call`.

## Migration Concerns

- `prisma db push --accept-data-loss --schema=prisma/schema.prisma` against
  dev SQLite. Pure additive, no data loss.
- Production: `prisma migrate deploy` at deploy time (not in scope this
  sprint).
- Token leakage risk: the plaintext access token is returned ONCE in the
  `POST /oauth/token` response. The hash is stored. Same constraint as
  LlmProxyToken. No retrieval API after issuance.

## Risks

- **Bearer auth surface area.** The `oauthBearer` middleware is the gate
  for `/v1/users*` and (next sprint) `/oauth/userinfo`. It must be
  airtight: constant-time hash compare, expiry/revocation check, scope
  check. Cover with focused unit tests.
- **PII surface.** `/v1/users` exposes `display_name`, `primary_email`,
  `role`, `is_active` to any authenticated client with `users:read`.
  Acceptable for the League's first integration target; flag for review
  if integrations diverge.
- **Concurrent secret rotation.** Two admins rotating simultaneously
  could race. We accept last-writer-wins; the older secret simply stops
  working. Document in the rotation route.
