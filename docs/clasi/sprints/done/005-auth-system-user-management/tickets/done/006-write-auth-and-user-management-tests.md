---
id: '006'
title: Write auth and user management tests
status: todo
use-cases:
- SUC-004
- SUC-005
depends-on:
- '004'
- '005'
---

# Write auth and user management tests

## Description

Write server-side integration tests covering authentication flows and
admin user management. All tests use the `POST /api/auth/test-login`
endpoint for authentication -- never mock session middleware or fabricate
cookies. Use `request.agent(app)` (Supertest) to maintain session
cookies across requests within each test suite.

### Changes

1. **Create `tests/server/auth.test.ts`** — Auth tests:
   - `POST /api/auth/test-login` with `{ email }` creates a session
     and returns a User record
   - `POST /api/auth/test-login` with `{ email, role: 'ADMIN' }`
     creates an admin session
   - Multiple test-logins with the same email reuse the existing User
   - `GET /api/auth/me` returns the authenticated User record
   - `GET /api/auth/me` returns 401 when not logged in
   - `POST /api/auth/logout` clears the session
   - After logout, `GET /api/auth/me` returns 401

2. **Create `tests/server/admin-users.test.ts`** — Admin user
   management tests:
   - `GET /api/admin/users` returns user list for admin (200)
   - `GET /api/admin/users` returns 403 for USER role
   - `GET /api/admin/users` returns 401 for unauthenticated request
   - `POST /api/admin/users` creates a user (assert HTTP response AND
     database state via Prisma query)
   - `POST /api/admin/users` returns 403 for non-admin
   - `PUT /api/admin/users/:id` updates user role (assert both response
     and database)
   - `PUT /api/admin/users/:id` refuses to demote last admin (400)
   - `DELETE /api/admin/users/:id` deletes a user (assert both response
     and database)
   - `DELETE /api/admin/users/:id` returns 403 for non-admin

3. **Test patterns**:
   - Use `request.agent(app)` for session persistence
   - Assert both HTTP response status/body AND database state for
     mutations
   - Use separate agents for admin and non-admin users in the same
     test file

## Acceptance Criteria

- [ ] `tests/server/auth.test.ts` exists and covers test-login, /me,
  logout, and role-based scenarios
- [ ] `tests/server/admin-users.test.ts` exists and covers all admin
  user CRUD routes
- [ ] Tests use `POST /api/auth/test-login` for authentication (no
  session mocks)
- [ ] Tests use `request.agent(app)` for session cookie persistence
- [ ] Mutation tests assert both HTTP response and database state
- [ ] Role-based 403 tests confirm non-admin users are blocked
- [ ] Unauthenticated 401 tests confirm anonymous users are blocked
- [ ] All tests pass: `npm run test:server`

## Testing

- **Tests to run**: `npm run test:server`
- **Verification command**: `npm run test:server`
