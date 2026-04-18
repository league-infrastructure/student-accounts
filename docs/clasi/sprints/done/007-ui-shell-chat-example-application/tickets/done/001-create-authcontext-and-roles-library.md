---
id: '001'
title: Create AuthContext and roles library
status: todo
use-cases:
- SUC-001
- SUC-006
depends-on: []
---

# Create AuthContext and roles library

## Description

Create the client-side authentication context and roles utility library that
the entire UI shell depends on. These two modules provide auth state to all
components and role-based visibility logic for navigation.

### Changes

1. **`client/src/context/AuthContext.tsx`**:
   - Create `AuthContext` with `AuthProvider` wrapper component
   - Implement `useAuth()` hook returning `{ user, loading, logout }`
   - On mount, fetch `GET /api/auth/me` to populate user state
   - If authenticated, set `user` with full record (id, email, displayName,
     role, avatarUrl)
   - If not authenticated (401), set `user` to `null`
   - `logout()` calls `POST /api/auth/logout` and clears user state
   - Default placeholder: display "Eric Busboom" / "student" when no real
     auth session exists (for template demonstration)

2. **`client/src/lib/roles.ts`**:
   - Export `ROLES` constant object (`USER`, `ADMIN`)
   - Export `UserRole` type
   - Export `ROLE_LABELS` (full labels: "User", "Administrator")
   - Export `ROLE_SHORT_LABELS` (short labels: "user", "admin")
   - Export `hasAdminAccess(role: string | undefined): boolean` helper
   - Export badge/style helpers for role display in the UI

## Acceptance Criteria

- [ ] `client/src/context/AuthContext.tsx` exports `AuthProvider` and `useAuth`
- [ ] `useAuth()` returns `{ user, loading, logout }` with correct types
- [ ] On mount, `AuthProvider` fetches `GET /api/auth/me`
- [ ] When authenticated, `user` contains id, email, displayName, role, avatarUrl
- [ ] When not authenticated, `user` is `null`
- [ ] `logout()` calls `POST /api/auth/logout` and sets `user` to `null`
- [ ] Default placeholder shows "Eric Busboom" / "student" when no session exists
- [ ] `client/src/lib/roles.ts` exports `ROLES`, `UserRole`, `ROLE_LABELS`,
      `ROLE_SHORT_LABELS`, and `hasAdminAccess`
- [ ] `hasAdminAccess('ADMIN')` returns `true`; all other values return `false`

## Testing

- **Existing tests to run**: `npm run test:client` to verify no regressions
- **New tests to write**: Deferred to ticket 008 (Write chat and UI tests)
- **Verification command**: `npm run test:client`
