---
id: '002'
title: Create UserService and register in ServiceRegistry
status: todo
use-cases:
- SUC-002
- SUC-003
depends-on:
- '001'
---

# Create UserService and register in ServiceRegistry

## Description

Create a `UserService` class that encapsulates all CRUD operations for
User records and register it in the existing ServiceRegistry. This
service will be used by OAuth callbacks, auth middleware, admin routes,
and the test-login endpoint.

### Changes

1. **Create `server/src/services/user.service.ts`**:
   - `list()` — Return all users, ordered by `createdAt` descending
   - `getById(id: number)` — Return a single user by ID, or `null`
   - `getByEmail(email: string)` — Return a user by email, or `null`
   - `getByProviderIds(provider: string, providerId: string)` — Return
     a user by provider + providerId composite, or `null`
   - `upsertFromOAuth(provider: string, providerId: string, data: { email, displayName?, avatarUrl? })` —
     Create or update a User from OAuth profile data
   - `create(data: { email, displayName?, role? })` — Admin-initiated
     user creation
   - `update(id: number, data: { displayName?, role? })` — Update user
     fields
   - `delete(id: number)` — Delete a user by ID

2. **Update `server/src/services/service.registry.ts`**:
   - Import and instantiate `UserService`
   - Register as `services.users` (or equivalent pattern used by
     existing services)

3. **Export types**: Export any TypeScript types needed by consumers
   (e.g., `CreateUserData`, `UpdateUserData`).

## Acceptance Criteria

- [ ] `UserService` class exists at `server/src/services/user.service.ts`
- [ ] `list()` returns all users ordered by `createdAt` descending
- [ ] `getById()` returns a user or `null`
- [ ] `getByEmail()` returns a user or `null`
- [ ] `getByProviderIds()` returns a user by provider + providerId or `null`
- [ ] `upsertFromOAuth()` creates a new user or updates an existing one
- [ ] `create()` creates a user with optional role (defaults to USER)
- [ ] `update()` updates specified fields on an existing user
- [ ] `delete()` removes a user by ID
- [ ] `UserService` is registered in `ServiceRegistry` and accessible
- [ ] Server compiles with `tsc --noEmit`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: UserService will be exercised through integration
  tests in ticket 006; no standalone unit tests required unless the service
  contains complex business logic beyond Prisma calls
- **Verification command**: `cd server && npx tsc --noEmit`
