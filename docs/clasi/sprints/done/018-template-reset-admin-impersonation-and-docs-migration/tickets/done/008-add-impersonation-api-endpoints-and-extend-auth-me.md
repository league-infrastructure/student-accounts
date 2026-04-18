---
id: 008
title: Add impersonation API endpoints and extend auth/me
status: done
use-cases:
- SUC-004
- SUC-005
- SUC-006
depends-on:
- '007'
github-issue: ''
todo: plan-admin-user-impersonation.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 008 — Add impersonation API endpoints and extend auth/me

## Description

Add two endpoints to `routes/admin/users.ts` that start and stop impersonation, and extend
`GET /api/auth/me` to include impersonation state so the frontend can reflect it.

Depends on ticket 007 (impersonation middleware mounted; session fields typed).

## Files to Modify

**`server/src/routes/admin/users.ts`:**

Add `POST /api/admin/users/:id/impersonate`:
```
- requireAdmin (uses real admin check from ticket 007)
- Validate: target user exists (404 if not)
- Validate: target.id !== req.realAdmin?.id ?? req.user.id (409 if self-impersonation)
- Set: req.session.impersonatingUserId = target.id
- Set: req.session.realAdminId = (req.realAdmin?.id ?? req.user.id)
- Return: 200 { success: true, impersonating: { id, displayName, email, role } }
```

Add `POST /api/admin/stop-impersonating`:
```
- requireAuth (any authenticated request; no requireAdmin — even a currently-impersonated
  non-admin can stop impersonation via the UI)
- Clear: delete req.session.impersonatingUserId
- Clear: delete req.session.realAdminId
- Return: 200 { success: true }
```

**`server/src/routes/auth.ts`** (`GET /api/auth/me`):

Read the current `me` response shape, then extend it:
```ts
// Current: { id, email, displayName, role, ... }
// Add when impersonating:
{
  ...existingFields,
  impersonating: !!req.realAdmin,
  realAdmin: req.realAdmin
    ? { id: req.realAdmin.id, displayName: req.realAdmin.displayName }
    : null,
}
```

## Acceptance Criteria

- [x] `POST /api/admin/users/:id/impersonate` sets session fields and returns 200
- [x] `POST /api/admin/users/:id/impersonate` returns 404 if target user does not exist
- [x] `POST /api/admin/users/:id/impersonate` returns 409 if target is self
- [x] `POST /api/admin/users/:id/impersonate` returns 403 if caller is not admin
- [x] `POST /api/admin/stop-impersonating` clears session fields and returns 200
- [x] `GET /api/auth/me` includes `impersonating: true` and `realAdmin: { id, displayName }` during impersonation
- [x] `GET /api/auth/me` includes `impersonating: false` and `realAdmin: null` when not impersonating
- [x] TypeScript compiles without errors
- [x] `npm run test:server` passes

## Implementation Plan

1. Read `server/src/routes/admin/users.ts` to understand current structure.
2. Read `server/src/routes/auth.ts` `GET /api/auth/me` handler.
3. Add `POST /:id/impersonate` endpoint to users router.
4. Add `POST /stop-impersonating` endpoint to users router (or to auth router — check where
   it is more natural to mount given the `stop-impersonating` path; TODO says admin route).
5. Edit `GET /api/auth/me` to include `impersonating` and `realAdmin` fields.
6. Run `tsc --noEmit`.
7. Run `npm run test:server`.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `POST /api/admin/users/:id/impersonate` happy path → 200, session fields set
  - `POST /api/admin/users/:id/impersonate` with non-existent user → 404
  - `POST /api/admin/users/:id/impersonate` with own id → 409
  - `POST /api/admin/users/:id/impersonate` without admin → 403
  - `POST /api/admin/stop-impersonating` happy path → 200, session fields cleared
  - `GET /api/auth/me` during impersonation → has `impersonating: true` + `realAdmin`
  - `GET /api/auth/me` without impersonation → has `impersonating: false`, `realAdmin: null`
- **Verification command**: `npm run test:server`
