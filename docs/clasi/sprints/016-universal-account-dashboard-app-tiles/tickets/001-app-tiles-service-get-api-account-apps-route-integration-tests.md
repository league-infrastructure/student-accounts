---
id: "001"
title: "app-tiles service + GET /api/account/apps route + integration tests"
status: todo
use-cases: [SUC-016-001, SUC-016-002, SUC-016-003]
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# app-tiles service + GET /api/account/apps route + integration tests

## Description

Add the server-side surface that drives the new universal account dashboard. A
pure tile-computation service maps `(role, llmProxyEnabled)` to an `AppTile[]`,
and a thin HTTP route delivers it to the authenticated caller.

**New files:**

- `server/src/services/app-tiles.service.ts` — pure function. Inputs:
  `{ role: 'student' | 'staff' | 'admin', llmProxyEnabled: boolean }`. Output:
  `AppTile[]` where each tile is `{ id, title, description, href, icon }`.
  No I/O, no Prisma, no Express.
- `server/src/routes/account-apps.ts` — Express router exporting
  `accountAppsRouter`. Mounts `GET /apps` (full path becomes `/api/account/apps`
  when mounted under `/api/account`). Behind `requireAuth`. Reads
  `req.session.userId`, looks up the user's active LLM proxy token via
  `req.services.llmProxyTokens.getActiveForUser(userId)`, calls the service,
  returns JSON `{ tiles: AppTile[] }`.

**Modified files:**

- `server/src/routes/account.ts` — mount the new router under the existing
  `/api/account` namespace (or, if simpler, mount `account-apps.ts` directly in
  `app.ts` at `/api/account` alongside the existing account router).

**Tile catalog (initial set):**

| id | title | description | href | icon | shown when |
|---|---|---|---|---|---|
| `user-management` | User Management | Manage student, staff, and admin accounts | `/admin/users` | `users` | role in {staff, admin} |
| `staff-directory` | Staff Directory | Look up League staff | `/staff/directory` | `directory` | role in {staff, admin} |
| `llm-proxy` | LLM Proxy | Use Claude through your League proxy token | `/account` (anchor `#llm-proxy`) | `bot` | role=student AND llmProxyEnabled |
| `cohorts` | Cohorts | Manage class cohorts | `/admin/cohorts` | `cohort` | role=admin |
| `groups` | Groups | Manage student groups | `/admin/groups` | `group` | role=admin |

(The implementer may adjust icon names to whatever the client renderer
supports; treat the column as a free-form string key.)

## Acceptance Criteria

- [ ] `server/src/services/app-tiles.service.ts` exists, exports `computeAppTiles({ role, llmProxyEnabled }): AppTile[]`, and is a pure function with no imports of prisma, express, or any I/O module.
- [ ] `server/src/routes/account-apps.ts` exists and mounts `GET /apps` behind `requireAuth`.
- [ ] The route is wired into `app.ts` (or `account.ts`) such that `GET /api/account/apps` is reachable.
- [ ] Response shape: `{ tiles: AppTile[] }`. Each tile has `id, title, description, href, icon` strings.
- [ ] Unauthenticated request returns 401.
- [ ] Authenticated student without LLM token: tiles do NOT include `llm-proxy`, do NOT include `user-management`.
- [ ] Authenticated student WITH active LLM token: tiles include `llm-proxy`.
- [ ] Authenticated staff: tiles include `user-management`, `staff-directory`; do NOT include `cohorts` or `groups` (admin-only).
- [ ] Authenticated admin: tiles include `user-management`, `staff-directory`, `cohorts`, `groups`.
- [ ] Unit tests for `computeAppTiles` cover all five role/grant combinations.
- [ ] Integration tests for `GET /api/account/apps` cover: 401 unauthenticated, student-no-token, student-with-token, staff, admin.
- [ ] Pre-existing server suite still passes (1407 baseline, modulo the known SQLite ordering flake).

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/services/app-tiles.service.test.ts` — unit tests on the pure function.
  - `tests/server/routes/account-apps.test.ts` — supertest integration tests against the real test DB. Use `agent.post('/api/auth/test-login')` to set up sessions for each role; create an `LlmProxyToken` directly via prisma to exercise the with-token path.
- **Verification command**: `npm run test:server`
