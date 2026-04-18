---
id: '001'
title: Add User model and migration
status: todo
use-cases:
- SUC-001
depends-on: []
---

# Add User model and migration

## Description

Add a `UserRole` enum and `User` model to the Prisma schema to provide
persistent user identity in the database. Currently, OAuth profile data
lives only in the session with no database backing. This model is the
foundation for all other tickets in this sprint.

### Changes

1. **`server/prisma/schema.prisma`**:
   - Add `UserRole` enum with values `USER` and `ADMIN`
   - Add `User` model with fields:
     - `id Int @id @default(autoincrement())`
     - `email String @unique`
     - `displayName String?`
     - `role UserRole @default(USER)`
     - `avatarUrl String?`
     - `provider String?` (e.g., `'github'`, `'google'`)
     - `providerId String?` (OAuth provider's user ID)
     - `createdAt DateTime @default(now())`
     - `updatedAt DateTime @updatedAt`
     - `@@unique([provider, providerId])` composite unique constraint

2. **Run migration**: `npx prisma migrate dev --name add-user-model`

3. **Verify**: Confirm the migration creates the `User` table and
   `UserRole` enum in the database. Confirm `npx prisma generate`
   produces the updated client.

## Acceptance Criteria

- [ ] `UserRole` enum exists in Prisma schema with values `USER` and `ADMIN`
- [ ] `User` model exists with all specified fields and correct types
- [ ] `email` field has `@unique` constraint
- [ ] `@@unique([provider, providerId])` composite constraint exists
- [ ] `role` field defaults to `USER`
- [ ] Migration file is created and applies cleanly to a fresh database
- [ ] `npx prisma generate` succeeds and the generated client includes the `User` model
- [ ] Server compiles with `tsc --noEmit` after schema change

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **Verification command**: `cd server && npx prisma migrate dev --name add-user-model && npx tsc --noEmit`
