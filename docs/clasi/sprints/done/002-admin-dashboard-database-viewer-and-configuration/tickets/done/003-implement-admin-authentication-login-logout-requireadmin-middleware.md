---
id: '003'
title: Implement admin authentication (login, logout, requireAdmin middleware)
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '001'
- '002'
---

# Implement admin authentication (login, logout, requireAdmin middleware)

## Description

Implement the admin authentication system: backend login/logout endpoints,
requireAdmin middleware for protecting admin routes, and the frontend login
page. Uses `ADMIN_PASSWORD` env var with `crypto.timingSafeEqual` for
constant-time comparison.

## Tasks

1. Extend `express-session` SessionData type to include `isAdmin?: boolean`.

2. Create `server/src/middleware/requireAdmin.ts`:
   - Check `req.session.isAdmin === true`
   - Return 401 `{ error: "Admin authentication required" }` if not set

3. Create `server/src/routes/admin/index.ts`:
   - Mount auth, db, config, env, logs, sessions sub-routers
   - Apply `requireAdmin` to all routes except `/api/admin/login`

4. Create `server/src/routes/admin/auth.ts`:
   - `POST /api/admin/login` — accepts `{ password }`, compares against
     `process.env.ADMIN_PASSWORD` using `crypto.timingSafeEqual`. Sets
     `req.session.isAdmin = true` on success. Returns 401 on failure.
   - `POST /api/admin/logout` — sets `req.session.isAdmin = false`,
     returns 200.
   - `GET /api/admin/check` — returns `{ authenticated: true/false }`
     (used by AdminLayout to check auth status).

5. Mount the admin router in `app.ts`: `app.use('/api', adminRouter)`.

6. Update `client/src/pages/admin/AdminLogin.tsx`:
   - Password input form
   - POST to `/api/admin/login` on submit
   - Redirect to `/admin/env` on success
   - Show error message on failure

7. Update `AdminLayout.tsx` to redirect to `/admin` if `/api/admin/check`
   returns `{ authenticated: false }`.

## Acceptance Criteria

- [ ] POST `/api/admin/login` with correct password returns 200
- [ ] POST `/api/admin/login` with wrong password returns 401
- [ ] POST `/api/admin/login` without ADMIN_PASSWORD env var returns 503
- [ ] Admin flag persists across requests (session stored in PostgreSQL)
- [ ] POST `/api/admin/logout` clears admin flag
- [ ] GET `/api/admin/check` returns authentication status
- [ ] All other `/api/admin/*` routes return 401 without admin session
- [ ] Frontend login form works end-to-end
- [ ] AdminLayout redirects unauthenticated users to login

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/admin-auth.test.ts`: login success, login failure, logout,
    requireAdmin middleware blocks unauthenticated requests, check endpoint
- **Verification command**: `npm run test:server`
