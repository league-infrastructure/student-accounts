---
id: '001'
title: Add RoleAssignmentPattern model and permissions service
status: todo
use-cases:
- SUC-001
depends-on: []
---

# Add RoleAssignmentPattern model and permissions service

## Description

Add the `RoleAssignmentPattern` Prisma model and create a `PermissionsService`
that evaluates patterns against user emails during OAuth login. This enables
admins to define rules that automatically assign roles (USER or ADMIN) to
users based on their email address, either by exact match or regex pattern.

### Changes

1. **`server/prisma/schema.prisma`** — Add the `RoleAssignmentPattern` model:
   ```prisma
   model RoleAssignmentPattern {
     id        Int      @id @default(autoincrement())
     matchType String   // 'exact' or 'regex'
     pattern   String   // email address or regex pattern
     role      UserRole @default(USER)
     createdAt DateTime @default(now())
     updatedAt DateTime @updatedAt

     @@unique([matchType, pattern])
   }
   ```

2. **Run `npx prisma migrate dev`** to generate the migration.

3. **`server/src/services/permissions.service.ts`** — Create `PermissionsService`
   with the following methods:
   - `listPatterns()` — Return all `RoleAssignmentPattern` records ordered by
     `createdAt`.
   - `createPattern(matchType, pattern, role)` — Validate input (reject invalid
     regex), create and return the record.
   - `deletePattern(id)` — Delete a pattern by ID.
   - `matchEmail(email)` — Evaluate the given email against all patterns. Check
     exact matches first, then regex patterns in creation order. Return the
     matched role or `null` if no match.

4. **Update OAuth login handler** — After the user upsert in the OAuth callback,
   call `PermissionsService.matchEmail(user.email)`. If a role is returned and
   differs from the user's current role, update the user's role.

5. **Register `PermissionsService`** in `ServiceRegistry` as `permissions`.

### Security

- Regex patterns must be validated at creation time. Reject patterns that fail
  `new RegExp(pattern)` compilation.
- Consider a length limit on regex patterns to mitigate ReDoS risk.

## Acceptance Criteria

- [ ] `RoleAssignmentPattern` model exists in Prisma schema with `matchType`,
      `pattern`, `role`, timestamps, and a unique constraint on `[matchType, pattern]`
- [ ] Migration runs cleanly on a fresh database
- [ ] `PermissionsService.listPatterns()` returns all patterns ordered by creation date
- [ ] `PermissionsService.createPattern()` validates regex and rejects invalid patterns
- [ ] `PermissionsService.deletePattern()` removes a pattern by ID
- [ ] `PermissionsService.matchEmail()` checks exact matches first, then regex
- [ ] OAuth login applies matched role to user on login
- [ ] `PermissionsService` is registered in `ServiceRegistry`
- [ ] Server compiles with `tsc --noEmit`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 007; unit verification via
  `tsc --noEmit` and manual testing during development
- **Verification command**: `cd server && npx tsc --noEmit`
