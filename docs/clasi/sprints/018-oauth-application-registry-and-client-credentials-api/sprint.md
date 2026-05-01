---
id: "018"
title: "OAuth Application Registry and Client-Credentials API"
status: planning
branch: sprint/018-oauth-application-registry-and-client-credentials-api
use-cases: [SUC-018-001, SUC-018-002, SUC-018-003, SUC-018-004]
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 018: OAuth Application Registry and Client-Credentials API

## Goals

This app becomes an **OAuth provider** for third-party services. Admins can
register OAuth client applications (client_id + secret + redirect URIs).
External clients exchange credentials for an opaque access token via the
client-credentials grant and call a small read-only directory API
(`GET /v1/users`, `GET /v1/users/:id`).

This sprint proves the OAuth token plumbing on the simpler grant before
sprint 019 wires up the user-facing authorization-code flow.

## Problem

The plan calls for this app to become the League's identity service. Other
internal services need to fetch user data programmatically — a User
Directory API. The simplest way to gate that API is to issue OAuth tokens
to registered service clients.

We don't yet have any of the OAuth provider infrastructure: no client
registry, no token issuance, no bearer auth, no scope checking.

## Solution

1. **Schema:** add `OAuthClient` and `OAuthAccessToken` models. `OAuthClient` stores `client_id` (unique, public), `client_secret_hash` (SHA-256), `name`, `description`, `redirect_uris` (String[]), `allowed_scopes` (String[]), `created_by` FK to User, timestamps, `disabled_at`. `OAuthAccessToken` mirrors the existing `LlmProxyToken` shape: opaque token hashed to SHA-256, scopes (String[]), expiry, revoked_at, last_used_at, FK to OAuthClient and optionally User (null for client-credentials).
2. **Routes:**
   - `POST /oauth/token` (grant_type=client_credentials only this sprint). Validates client_id + secret via constant-time hash compare, issues an opaque access token, stores hash + metadata. Standard OAuth response: `{ access_token, token_type: 'Bearer', expires_in, scope }`.
   - `oauthBearer` middleware that validates an `Authorization: Bearer <token>` header against `OAuthAccessToken`, checks expiry/revocation, updates `last_used_at`, attaches `req.oauth = { client_id, user_id, scopes }`.
3. **Directory API** at `/v1` (mounted in `app.ts`, behind `oauthBearer` and a scope check):
   - `GET /v1/users` — paginated list. Fields: `id, display_name, primary_email, role, is_active`. Required scope: `users:read`.
   - `GET /v1/users/:id` — single record. Slightly more detail (add `cohort_id`, `created_at`).
4. **Admin CRUD** (`/api/admin/oauth-clients`):
   - `GET /api/admin/oauth-clients` — list clients (no secrets).
   - `POST /api/admin/oauth-clients` — create. Returns the new client AND the plaintext secret in a one-time field. Mirrors the LlmProxyToken "show plaintext once" pattern.
   - `PATCH /api/admin/oauth-clients/:id` — update name/description/redirect_uris/allowed_scopes/disabled_at.
   - `POST /api/admin/oauth-clients/:id/rotate-secret` — generate a new secret, update hash, return plaintext once.
   - `DELETE /api/admin/oauth-clients/:id` — soft delete (set `disabled_at`).
   - All admin routes guarded by `requireRole('admin')`.
5. **Audit:** every client create, secret rotation, disable, and every `/v1/users*` call writes an `AuditEvent` (existing model). Token issuance also logged.
6. **Admin UI:** new page `client/src/pages/admin/OAuthClients.tsx` reachable from the User Management sub-app. List clients, create, rotate secret, disable. After create or rotate, display the secret in a "copy now, you won't see it again" modal.

## Success Criteria

- New schema applied via `prisma db push`.
- Admin can create an OAuth client through the UI; secret is shown once.
- `curl -u client_id:secret -d grant_type=client_credentials https://localhost:5201/oauth/token` returns a valid `{ access_token, token_type: 'Bearer', expires_in }` response.
- `curl -H "Authorization: Bearer <token>" http://localhost:5201/v1/users` returns the user list.
- Calling `/v1/users` with a missing/expired/revoked token returns 401.
- Calling `/v1/users` with a token that lacks `users:read` scope returns 403.
- Disabled client cannot mint new tokens (401).
- Audit-log entries written for create, rotate, disable, every directory API call.
- All existing tests still pass; new tests cover the full flow.

## Scope

### In Scope

- `OAuthClient` and `OAuthAccessToken` schema additions.
- `POST /oauth/token` (client_credentials grant only).
- `oauthBearer` middleware.
- `GET /v1/users` and `GET /v1/users/:id` (read-only directory API).
- Admin CRUD routes for OAuth clients.
- Admin UI page for OAuth clients.
- Audit logging.
- Integration tests covering happy path + 401/403 paths.

### Out of Scope

- `grant_type=authorization_code` and `grant_type=refresh_token` (sprint 019).
- `/oauth/authorize`, consent screen, PKCE (sprint 019).
- `/oauth/userinfo` (sprint 019).
- Refresh tokens (sprint 019).
- Per-user token revocation UI (defer; admin disable is enough for v1).
- Rate limiting beyond what already exists in the app.

## Test Strategy

Integration tests against the real test DB. Cover:

- Admin create client → response includes plaintext secret + sanitized client.
- Admin list clients → response excludes secrets.
- Admin rotate secret → old secret stops working, new secret works.
- Admin disable client → all token mints fail, existing tokens fail.
- `POST /oauth/token` with valid credentials and `grant_type=client_credentials` → 200 + bearer token.
- `POST /oauth/token` with invalid client_id, wrong secret, missing fields, wrong grant_type → 4xx.
- `GET /v1/users` with valid bearer token + `users:read` scope → 200 + array.
- `GET /v1/users/:id` with valid token → 200 + record.
- `GET /v1/users` without token → 401.
- `GET /v1/users` with expired or revoked token → 401.
- `GET /v1/users` with token lacking `users:read` scope → 403.
- Audit events written for all admin and OAuth flows.

Unit tests for the constant-time secret comparison and the token-hash
pattern (mirror existing LlmProxyToken tests).

## Architecture Notes

- **Hash everything secret.** Client secrets hashed with SHA-256. Access
  tokens hashed with SHA-256. Plaintext shown once on create/rotate, then
  only the hash is stored. Mirror `server/src/services/llm-proxy/` patterns —
  do NOT invent a new hashing scheme.
- **`oauthBearer` middleware** is generic — takes a required-scope string,
  validates the bearer token, updates `last_used_at`, attaches a typed
  `req.oauth` object. Used for both `/v1/users*` (this sprint) and
  `/oauth/userinfo` (next sprint).
- **`/v1/users*` is mounted at `/v1` (NOT `/api/v1`).** The OAuth tokens are
  for external services; conventionally the API namespace is just `/v1`.
- **`OAuthClient.created_by` FK** → User. Tracks who registered the client.
  Used for audit only; doesn't gate access.
- **`OAuthAccessToken.user_id` is nullable.** Client-credentials tokens are
  service-to-service; no user is on behalf. Sprint 019's authorization-code
  tokens will set this.

## GitHub Issues

(None linked.)

## Definition of Ready

- [x] Sprint planning documents complete.
- [x] Architecture review passed.
- [x] Stakeholder approved.

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Schema OAuthClient and OAuthAccessToken models | — | 1 |
| 002 | OAuthClient service create rotate disable | 001 | 2 |
| 003 | POST /oauth/token client-credentials grant | 002 | 3 |
| 004 | oauthBearer middleware with scope check | 003 | 3 |
| 005 | GET /v1/users and /v1/users/:id directory API | 004 | 4 |
| 006 | Admin CRUD routes /api/admin/oauth-clients | 002 | 3 |
| 007 | Admin UI page client/src/pages/admin/OAuthClients.tsx | 006 | 5 |
| 008 | Manual smoke pass | 001-007 | 6 |
