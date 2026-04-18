---
id: '005'
title: Auth System & User Management
status: done
branch: sprint/005-auth-system-user-management
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
---

# Sprint 005: Auth System & User Management

## Goals

Add a `User` model to the database, upgrade the OAuth flow to
create/update User records on login, implement role-based access control
with USER and ADMIN roles, create a UserService in the ServiceRegistry,
build an admin Users panel, and add a test-login endpoint for test and
development environments.

## Problem

The current auth system stores OAuth profile data only in the session.
There is no `User` model in the database, which means:

- No persistent user identity across sessions
- No role-based access control (admin access is via a separate password)
- No way to list, manage, or audit users
- No reliable test authentication mechanism for automated tests
- Routes cannot enforce fine-grained permissions

These gaps block every downstream feature that depends on knowing who
the current user is (chat, admin panels, MCP tools, etc.).

## Dependencies

This sprint depends on **Sprint 004** (Infrastructure, Config Migration,
Dev Environment, Service Registry). The ServiceRegistry must exist before
UserService can be added to it.

## Solution

1. Add a `User` model and `UserRole` enum to the Prisma schema.
2. Update Passport OAuth serialization to upsert User records on login
   (match by provider + providerId).
3. Create a `UserService` with CRUD operations and register it in the
   ServiceRegistry.
4. Create `requireAuth()` and `requireAdmin()` middleware.
5. Build admin API routes for user management (list, create, edit role,
   delete).
6. Build a `UsersPanel` React component for the admin dashboard.
7. Add `POST /api/auth/test-login` for test and dev environments.
8. Write auth tests covering login, `/me`, role-based 403s, and admin
   user management.

## Success Criteria

- OAuth login creates a User record in the database (verified via
  Prisma query)
- `GET /api/auth/me` returns the full User record for authenticated
  users and 401 for unauthenticated requests
- Admin users can list, create, edit roles, and delete users via the
  admin panel
- Non-admin users receive 403 on admin routes
- `POST /api/auth/test-login` works in test/dev and is disabled in
  production
- All auth and admin user management tests pass
- Local dev only — no production deployment

## Scope

### In Scope

- `User` model with fields: id, email, displayName, role (USER/ADMIN
  enum), avatarUrl, provider, providerId, createdAt, updatedAt
- `UserRole` enum (USER, ADMIN) in Prisma schema
- Prisma migration for User model
- Update Passport OAuth callbacks (GitHub, Google) to upsert User
  records by provider + providerId
- Update session serialization to store user ID; deserialize loads
  full User from database
- `UserService` with list, create, update, delete operations
- Register UserService in ServiceRegistry
- `requireAuth()` middleware — checks `req.user` exists
- `requireAdmin()` middleware — checks user role is ADMIN
- Admin API routes: GET/POST/PUT/DELETE `/api/admin/users`
- `UsersPanel.tsx` admin component (table, create form, edit role,
  delete with confirmation)
- `POST /api/auth/test-login` endpoint (test/dev environments only)
- Update `GET /api/auth/me` to return full User record from database
- Server tests for auth and admin user management

### Out of Scope

- Client (frontend) layout changes — AppLayout and sidebar are a
  future sprint
- AuthContext React hook — deferred to UI shell sprint
- Permissions panel (pattern-based auto-role-assignment) — future sprint
- Admin password bootstrap mechanism changes (kept as-is)
- Production deployment
- Parent/counselor accounts
- Email/password local auth strategy

## Test Strategy

All tests use `POST /api/auth/test-login` for authentication — never
mock session middleware or fabricate cookies. Use `request.agent(app)`
to maintain session cookies across requests.

**Auth tests (`tests/server/`):**

- `POST /api/auth/test-login` creates session and returns user
- `GET /api/auth/me` returns authenticated user; 401 when not logged in
- `POST /api/auth/logout` clears session
- Role-based access: admin routes return 403 for USER role

**Admin user management tests (`tests/server/`):**

- `GET /api/admin/users` lists users (admin only, 403 for non-admin)
- `POST /api/admin/users` creates user (admin only)
- `PUT /api/admin/users/:id` updates user role
- `DELETE /api/admin/users/:id` deletes user
- Assert both HTTP response and database state for mutations

## Architecture Notes

See `architecture.md` for full details. Key decisions:

- User model uses autoincrement integer ID (consistent with template
  conventions)
- OAuth upsert matches on `provider` + `providerId` composite; email
  is updated on each login to handle provider email changes
- Session stores only user ID; full User loaded from DB on
  deserialization (avoids stale session data)
- test-login endpoint is guarded by `NODE_ENV !== 'production'` check
- Admin password login is kept as a bootstrap mechanism for initial
  setup

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

1. **001** — Add User model and migration
2. **002** — Create UserService and register in ServiceRegistry
3. **003** — Update Passport OAuth to upsert User records
4. **004** — Create auth middleware (requireAuth, requireAdmin)
5. **005** — Build admin user management panel
6. **006** — Write auth and user management tests
