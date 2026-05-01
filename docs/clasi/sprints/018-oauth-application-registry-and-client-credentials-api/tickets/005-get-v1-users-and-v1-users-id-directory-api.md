---
id: "005"
title: "GET /v1/users and /v1/users/:id directory API"
status: todo
use-cases: [SUC-018-003]
depends-on: ["004"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GET /v1/users and /v1/users/:id directory API

## Description

Add the read-only directory API at `/v1` — the user-facing surface that
external OAuth clients consume. Per `architecture-update.md` "New
Modules (Server)" this lives in
`server/src/routes/v1-directory.ts`, mounted at `/v1` (NOT `/api/v1`)
in `server/src/app.ts`. Both routes are guarded by
`oauthBearer('users:read')` from ticket 004.

Endpoints:

- `GET /v1/users` — paginated list. Query params `?page=1&per_page=50`,
  defaulting to those values, capped at `per_page=200`. Mirror the
  pagination shape used by the existing admin-users list route (look in
  `server/src/routes/admin/` for the pattern — same `{ items, page,
  per_page, total }` envelope or whatever the codebase already uses).
  Response item fields: `id`, `display_name`, `primary_email`, `role`,
  `is_active`. Exclude any sensitive columns (no hashes, no PII beyond
  the listed fields).
- `GET /v1/users/:id` — single record with the same fields plus
  `cohort_id` and `created_at`. 404 when not found.

Audit: write an `AuditEvent` `oauth_directory_call` per request. Keep
the payload cheap — `{ path, method, count }` (where `count` is the
returned-row count for the list, `1` for the detail route, `0` on 404).
Actor is null; `metadata` records `req.oauth.client_id` and the scope
used.

## Acceptance Criteria

- [ ] `server/src/routes/v1-directory.ts` exists and is mounted at `/v1`.
- [ ] Both routes are wrapped in `oauthBearer('users:read')`.
- [ ] List response uses pagination shape consistent with existing admin endpoints; `per_page` capped at 200; defaults `page=1`, `per_page=50`.
- [ ] List item fields are exactly `id`, `display_name`, `primary_email`, `role`, `is_active`.
- [ ] Detail response adds `cohort_id` and `created_at`.
- [ ] Missing token → 401 (delivered by middleware).
- [ ] Token without `users:read` → 403 (delivered by middleware).
- [ ] `oauth_directory_call` audit event written for every successful call (and 404).
- [ ] Sensitive columns (password hashes etc.) never serialized.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `server/src/routes/v1-directory.test.ts` — list happy path with auth + scope, list pagination caps, detail happy path, detail 404, list/detail without token (401), list/detail with wrong-scope token (403), audit event written per call, response field allowlist enforced.
- **Verification command**: `npm run test:server`
