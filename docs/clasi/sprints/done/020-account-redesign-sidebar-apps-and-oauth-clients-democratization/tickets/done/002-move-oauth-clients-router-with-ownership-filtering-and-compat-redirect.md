---
id: '002'
title: Move OAuth Clients router with ownership filtering and compat redirect
status: done
use-cases:
- SUC-020-003
depends-on: []
github-issue: ''
todo: plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Move OAuth Clients router with ownership filtering and compat redirect

## Description

Promote OAuth Clients out of `/admin` so every authenticated user can
register their own clients, while preserving admin override. See
`architecture-update.md` §§ "Renamed Modules (Server)" and "Modified
Modules (Server)" and use case **SUC-020-003**.

**Move the router.** Rename
`server/src/routes/admin/oauth-clients.ts` →
`server/src/routes/oauth-clients.ts` (rename the exported symbol
`adminOAuthClientsRouter` → `oauthClientsRouter`). In
`server/src/app.ts`, drop the import from `./routes/admin` (the admin
index re-exports the old router via `adminRouter`) and add a new mount
`app.use('/api', oauthClientsRouter)` (or `'/api/oauth-clients'`,
matching whatever path-shape the existing routes use — the existing
file declares routes as `/oauth-clients` and `/oauth-clients/:id`, so
mount under `/api`). The new mount sits behind `requireAuth` only —
**remove `requireRole('admin')`** from this surface. Also remove the
admin-router registration of `adminOAuthClientsRouter` in
`server/src/routes/admin/index.ts` (line 27 import + its `use` call).

**Compat redirect.** Add a thin compat router that handles
`/api/admin/oauth-clients` and `/api/admin/oauth-clients/*`, replying
with HTTP **308** (preserves method + body) to the equivalent
`/api/oauth-clients[...]` URL. Mount it before `oauthClientsRouter`
under `requireAuth` (so unauthenticated callers still get 401, not a
redirect). Use Express's `res.redirect(308, target)` and preserve the
original query string. Document inline that this redirect is
intentionally temporary — see sprint.md "Out of Scope" for the
follow-up release that drops it.

**Ownership in the service layer.** Update
`server/src/services/oauth/oauth-client.service.ts`:

- `list({ actorUserId, actorRole })` returns all clients when
  `actorRole === 'admin'`; otherwise filters
  `WHERE created_by = actorUserId`.
- `findById(id, { actorUserId, actorRole })`: if not admin and
  `client.created_by !== actorUserId`, throw a typed `ForbiddenError`
  (or whatever 403-mapped error the codebase already uses — reuse, do
  not invent).
- `update`, `disable`, `rotateSecret`: same admin-or-owner check up
  front.
- The `create` path stays unchanged — `created_by = actorUserId` was
  set in Sprint 018.

Update the route handlers (`server/src/routes/oauth-clients.ts`) to
pass `req.user.role` through to the service. Map `ForbiddenError` →
HTTP 403 in the existing error middleware; add a mapping if needed.

**Test file move.** Rename
`tests/server/routes/admin/oauth-clients.test.ts` →
`tests/server/routes/oauth-clients.test.ts`. Update imports and the
URL prefix from `/api/admin/oauth-clients` → `/api/oauth-clients`. Add
new ownership-filter cases (see Testing).

No schema migration. `OAuthClient.created_by` already exists from
Sprint 018.

## Acceptance Criteria

- [x] `server/src/routes/oauth-clients.ts` exists; `server/src/routes/admin/oauth-clients.ts` is deleted.
- [x] Mounted at `/api/oauth-clients` (auth-only); `requireRole('admin')` removed from this surface.
- [x] `server/src/routes/admin/index.ts` no longer references the old admin oauth-clients router.
- [x] Compat router redirects `GET/POST/PATCH/DELETE /api/admin/oauth-clients[/...]` → `/api/oauth-clients[/...]` with HTTP 308, preserving query string.
- [x] `oauth-client.service.ts` `list` returns all for admin, only-own for others.
- [x] `findById`, `update`, `disable`, `rotateSecret` enforce admin-or-owner; non-owner non-admin gets a typed forbidden error mapped to 403.
- [x] `tests/server/routes/oauth-clients.test.ts` exists with renamed + new cases (see Testing).
- [x] `npm run test:server` passes; baseline ~1620 holds.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write** (in `tests/server/routes/oauth-clients.test.ts`):
  - Student `GET /api/oauth-clients` lists only own clients (seeded a-mine + b-other → only a returned).
  - Staff `GET` same — only own clients.
  - Admin `GET` returns all clients.
  - Owner `PATCH /:id` succeeds; non-owner non-admin → 403; admin succeeds on someone else's.
  - Owner `POST /:id/rotate-secret` succeeds; non-owner non-admin → 403.
  - Owner `DELETE /:id` succeeds; non-owner non-admin → 403.
  - Compat redirect: `GET /api/admin/oauth-clients` → 308 with `Location: /api/oauth-clients`.
  - Compat redirect with subpath: `PATCH /api/admin/oauth-clients/42` → 308 to `/api/oauth-clients/42` (verify method preserved by following the redirect with supertest).
  - Compat redirect with query string: `GET /api/admin/oauth-clients?foo=bar` preserves `?foo=bar`.
- **Verification command**: `npm run test:server -- oauth-clients`
