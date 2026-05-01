---
id: '006'
title: Admin CRUD routes /api/admin/oauth-clients
status: done
use-cases:
- SUC-018-001
- SUC-018-004
depends-on:
- '002'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Admin CRUD routes /api/admin/oauth-clients

## Description

Create `server/src/routes/admin/oauth-clients.ts` and mount it under
the existing `/api/admin` prefix alongside the other admin routes (see
`architecture-update.md` "New Modules (Server)"). All endpoints in this
file are guarded by `requireRole('admin')` — reuse the existing admin
guard middleware; do not duplicate.

This ticket is purely the HTTP wiring; all business logic lives in the
service from ticket 002 (`oauthClients`). Endpoints:

- `GET /oauth-clients` — list. Returns sanitized rows (no
  `client_secret_hash`). Includes `disabled_at` so the UI can render
  status.
- `POST /oauth-clients` — create. Body: `{ name, description?,
  redirect_uris: string[], allowed_scopes: string[] }`. Calls
  `oauthClients.create(...)`. Response includes the sanitized client
  row AND `client_secret` (the plaintext, returned exactly once — same
  pattern as LlmProxyToken create).
- `PATCH /oauth-clients/:id` — partial update of `name`,
  `description`, `redirect_uris`, `allowed_scopes`. Does NOT rotate
  the secret.
- `POST /oauth-clients/:id/rotate-secret` — calls
  `oauthClients.rotateSecret(...)`. Response: `{ client_secret }`
  (plaintext, once).
- `DELETE /oauth-clients/:id` — soft delete via
  `oauthClients.disable(...)`. Returns 204.

Use the existing admin actor extraction (whatever pattern the other
`server/src/routes/admin/*.ts` files use) to pass `actorUserId` into
the service so audit events are correctly attributed.

## Acceptance Criteria

- [x] `server/src/routes/admin/oauth-clients.ts` exists and is mounted under `/api/admin`.
- [x] All five endpoints behind `requireRole('admin')`.
- [x] List response never contains `client_secret_hash` or any plaintext secret.
- [x] Create response contains both the sanitized client AND a single `client_secret` plaintext field.
- [x] Rotate response contains a single `client_secret` plaintext field; no other call returns plaintext.
- [x] PATCH validates that `redirect_uris` and `allowed_scopes` are arrays of strings.
- [x] DELETE sets `disabled_at` (soft delete) — row is not removed.
- [x] Audit events emitted via the service (verify in the test).
- [x] Non-admin users → 403 from the existing guard.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `server/src/routes/admin/oauth-clients.test.ts` — covers each endpoint as admin (happy path), each endpoint as non-admin (403), list omits secret hash, create returns plaintext once, rotate returns plaintext once, delete soft-deletes, PATCH validation rejects bad shapes.
- **Verification command**: `npm run test:server`
