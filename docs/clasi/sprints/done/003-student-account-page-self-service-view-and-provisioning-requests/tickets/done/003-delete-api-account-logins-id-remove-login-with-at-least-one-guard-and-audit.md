---
id: '003'
title: "DELETE /api/account/logins/:id \u2014 remove Login with at-least-one guard\
  \ and audit"
status: done
use-cases:
- SUC-003
depends-on:
- '002'
github-issue: ''
todo: ''
---

# DELETE /api/account/logins/:id — remove Login with at-least-one guard and audit

## Description

Add the `DELETE /api/account/logins/:id` endpoint to the `account.ts` route
module created in T002. This implements UC-011 (Student Removes Own Login):
the endpoint enforces that at least one Login remains, verifies the Login
belongs to the signed-in user, and records a `remove_login` AuditEvent.

The Sprint 001 `LoginService` already has a delete method with the last-login
guard. This ticket wires it to a student-scoped HTTP endpoint and adds the
user-ownership scope check.

## Acceptance Criteria

- [x] `DELETE /api/account/logins/:id` returns 204 when the Login belongs to
      the current user and at least two Logins remain after deletion.
- [x] Returns 409 when the user has exactly one Login (would leave zero).
- [x] Returns 404 when the login_id does not belong to the current user
      (scope guard — not 403, to avoid revealing cross-user login IDs).
- [x] Returns 401 when no session exists.
- [x] Returns 403 when session user is staff or admin.
- [x] `remove_login` AuditEvent is recorded atomically with the deletion.
- [x] Audit event details include `provider` and `loginId`.

## Implementation Plan

### Approach

Add a DELETE handler to `server/src/routes/account.ts`. The handler:
1. Calls `LoginService.findById(id)`.
2. If not found or `login.user_id !== session.userId`, returns 404.
3. Calls `LoginService.delete(id, actorId: session.userId)` which owns the
   at-least-one guard and the AuditEvent write inside a transaction.
4. Returns 204.

If `LoginService.delete` does not already have the audit call, add it here.
The Sprint 001 stub may have the guard but not the audit; verify and complete.

### Files to Modify

- `server/src/routes/account.ts` — add DELETE handler
- `server/src/services/login.service.ts` — add/complete audit call in delete
  if missing; confirm last-login guard is implemented

### Testing Plan

Add tests to `tests/server/routes/account.test.ts`:

1. Happy path: 2 logins, remove one → 204, login gone, audit recorded.
2. Last-login guard: 1 login, attempt remove → 409.
3. Cross-user attempt: login belongs to another user → 404.
4. Non-existent login id → 404.
5. Unauthenticated → 401.
6. Staff role → 403.
