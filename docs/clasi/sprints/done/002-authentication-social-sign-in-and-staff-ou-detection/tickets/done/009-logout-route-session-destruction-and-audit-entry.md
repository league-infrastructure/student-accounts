---
id: 009
title: "Logout route \u2014 session destruction and audit entry"
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

# T009: Logout route — session destruction and audit entry

## Description

Implement `POST /api/auth/logout`. The route destroys the session, calls
`passport.logout()`, and redirects to the sign-in page. Optionally records a
`logout` audit entry (best-effort: if the AuditService write fails, the logout
still succeeds — session destruction is mandatory; audit is optional).

The logout route was referenced in the OAuth route layout in the architecture
but needs explicit implementation and testing. It depends on T002 (which
mounts `routes/auth.ts`).

## Acceptance Criteria

- [x] `POST /api/auth/logout` is implemented in `routes/auth.ts`.
- [x] `passport.logout()` is called to clear the Passport user.
- [x] `req.session.destroy()` is called; the session cookie is cleared.
- [x] After successful logout, the response redirects to `/` (or returns 200
      for API clients with `{ success: true }`).
- [x] Logout is idempotent: calling it when already logged out returns 200
      (not 401).
- [x] A best-effort `logout` audit entry is recorded if a `userId` was in the
      session before destruction; failure to write the audit entry does not
      block the logout.
- [x] All existing tests pass.

## Implementation Plan

### Approach

1. Add `POST /api/auth/logout` handler to `routes/auth.ts`.
2. Handler: capture `userId` from session before destruction; call
   `passport.logout()`; call `req.session.destroy()`; clear cookie; redirect.
3. Fire-and-forget audit entry for the captured `userId` after session destruction
   (no transaction required; best-effort).

**Note on logout audit action string:** `logout` is not in the Sprint 001
canonical action string table. Add it to the table in `architecture-update.md`
(or simply use the string `logout` without formal table registration — it is
informational only, not security-critical).

### Files to Modify

- `server/src/routes/auth.ts` — add `POST /api/auth/logout`.

### Testing Plan

- `tests/server/routes/auth.logout.test.ts` (or extend `auth.integration.test.ts`):
  - Authenticated session: POST logout → session destroyed; redirect to `/`.
  - Unauthenticated request: POST logout → 200 (idempotent).
  - Session no longer valid after logout (follow-up request returns 401 on
    guarded routes).

### Documentation Updates

None — logout action string is informational.
