---
id: '007'
title: "Auth middleware \u2014 requireAuth and requireRole, wired into existing admin\
  \ routes"
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '002'
github-issue: ''
todo: ''
---

# T007: Auth middleware — requireAuth and requireRole, wired into existing admin routes

## Description

Complete `requireAuth` (scaffolded in Sprint 001 but non-functional) and
implement `requireRole`. Apply both to the appropriate routes. Sprint 001's
admin routes were unguarded — now they must be protected with
`requireAuth + requireRole('admin')`.

`requireAuth` and `requireRole` are session-only checks — no database calls.
They read `req.session.userId` and `req.session.role`.

## Acceptance Criteria

- [x] `server/src/middleware/requireAuth.ts` checks `req.session.userId`:
  - Present → `next()`.
  - Absent → 401 JSON `{ error: 'Unauthorized' }`.
- [x] `server/src/middleware/requireRole.ts` is a factory `requireRole(...roles)`:
  - `req.session.role` is in `roles` → `next()`.
  - Not in `roles` (including missing role) → 403 JSON `{ error: 'Forbidden' }`.
- [x] `server/src/routes/admin/index.ts` (and/or the admin router root) applies
      `requireAuth` and `requireRole('admin')` to all admin routes.
- [x] A request with no session to any admin route returns 401.
- [x] A request with a `role=student` session to any admin route returns 403.
- [x] A request with a `role=admin` session to any admin route passes through.
- [x] `/api/auth/me` returns `{ userId, role }` for authenticated sessions
      or 401 for unauthenticated.
- [x] All existing tests pass. (Note: if any existing admin-route tests relied
      on the routes being unguarded, they must be updated to inject a session.)

## Implementation Plan

### Approach

1. Complete `requireAuth.ts` — check `req.session.userId`.
2. Write `requireRole.ts` — factory returning a middleware that checks
   `req.session.role`.
3. Update `server/src/routes/admin/index.ts` to use `router.use(requireAuth,
   requireRole('admin'))` before route registration.
4. Add `/api/auth/me` route to `routes/auth.ts`.
5. Audit existing admin-route tests; update those that bypass auth to inject
   a mock session (`req.session.userId = 1; req.session.role = 'admin'`).

### Files to Modify

- `server/src/middleware/requireAuth.ts` — complete implementation.
- `server/src/middleware/requireRole.ts` — new middleware factory.
- `server/src/routes/admin/index.ts` — apply middleware.
- `server/src/routes/auth.ts` — add `GET /api/auth/me`.
- `tests/server/routes/admin/*.test.ts` — update to inject session if needed.

### Testing Plan

- `tests/server/middleware/requireAuth.test.ts`:
  - No session → 401.
  - Session with userId → passes.
- `tests/server/middleware/requireRole.test.ts`:
  - Role not in list → 403.
  - Role in list → passes.
  - Missing role → 403.
- Existing admin-route tests updated to use helper that injects an admin session.

### Documentation Updates

None.
