---
id: '004'
title: Create auth middleware (requireAuth, requireAdmin)
status: todo
use-cases:
- SUC-004
- SUC-005
depends-on:
- '002'
---

# Create auth middleware (requireAuth, requireAdmin)

## Description

Create `requireAuth()` and `requireAdmin()` Express middleware functions
for role-based access control. Also add the `POST /api/auth/test-login`
endpoint that allows automated tests to authenticate without OAuth,
guarded by `NODE_ENV`.

### Changes

1. **Create `server/src/middleware/requireAuth.ts`**:
   - `requireAuth()` — Returns middleware that checks `req.user` exists.
     If not, responds with `401 { error: 'Unauthorized' }`.
   - `requireAdmin()` — Returns middleware that first checks `req.user`
     exists (401 if not), then checks `req.user.role === 'ADMIN'`
     (403 `{ error: 'Forbidden' }` if not).

2. **Add `POST /api/auth/test-login` to `server/src/routes/auth.ts`**:
   - Guard: If `NODE_ENV === 'production'`, return 404 (endpoint not
     discoverable in production)
   - Accept JSON body: `{ email: string, role?: 'USER' | 'ADMIN' }`
   - Find or create a User with the given email using `UserService`
   - If `role` is provided, set/update the user's role
   - Call `req.login(user)` to establish a Passport session
   - Return the User record as JSON

3. **TypeScript**: Extend the Express `Request` type if needed so
   `req.user` is typed as the Prisma `User` model (or update the
   existing type declaration).

## Acceptance Criteria

- [ ] `requireAuth()` middleware returns 401 when `req.user` is not set
- [ ] `requireAuth()` middleware calls `next()` when `req.user` exists
- [ ] `requireAdmin()` middleware returns 401 when `req.user` is not set
- [ ] `requireAdmin()` middleware returns 403 when `req.user.role` is
  not `ADMIN`
- [ ] `requireAdmin()` middleware calls `next()` when user is ADMIN
- [ ] Response bodies include `{ error: 'Unauthorized' }` or
  `{ error: 'Forbidden' }` respectively
- [ ] `POST /api/auth/test-login` creates a session and returns a User
  record in test/dev environments
- [ ] `POST /api/auth/test-login` returns 404 when `NODE_ENV=production`
- [ ] `POST /api/auth/test-login` with `{ role: 'ADMIN' }` creates an
  admin user session
- [ ] Multiple calls with the same email reuse the existing User record
- [ ] Server compiles with `tsc --noEmit`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 006 (auth test suite)
- **Verification command**: `cd server && npx tsc --noEmit`
