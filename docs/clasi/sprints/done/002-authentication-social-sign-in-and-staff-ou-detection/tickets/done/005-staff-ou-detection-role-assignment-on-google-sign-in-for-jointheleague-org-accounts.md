---
id: '005'
title: "Staff OU detection \u2014 role assignment on Google sign-in for jointheleague.org\
  \ accounts"
status: done
use-cases:
- SUC-003
depends-on:
- '002'
- '004'
github-issue: ''
todo: ''
---

# T005: Staff OU detection — role assignment on Google sign-in for jointheleague.org accounts

## Description

Add the staff OU detection branch to the `SignInHandler`. After a successful
Google sign-in: if the email domain is `@jointheleague.org`, call
`AdminDirectoryClient.getUserOU(email)`. If the returned OU path starts with
`GOOGLE_STAFF_OU_PATH`, call `UserService.update(user.id, { role: 'staff' })`
and update the session. If the OU check fails (throws `StaffOULookupError`),
deny access. Add the `/staff` stub landing route.

This ticket completes UC-003.

## Acceptance Criteria

- [x] `SignInHandler` reads the email domain after a Google sign-in and calls
      `adminDirClient.getUserOU(email)` only for `@jointheleague.org` accounts.
- [x] `@students.jointheleague.org` accounts skip the OU check and receive
      `role=student`.
- [x] Any other domain skips the OU check and receives `role=student`.
- [x] OU path starts with `GOOGLE_STAFF_OU_PATH` → `UserService.update` sets
      `role=staff`; session carries `role: 'staff'`.
- [x] OU path does not start with `GOOGLE_STAFF_OU_PATH` → `role` is assigned
      `student` and sign-in completes normally; session carries `role: 'student'`.
      This covers `@jointheleague.org` accounts that exist in the Admin Directory
      but are not yet in the staff OU (e.g., newly hired staff during onboarding).
      Access is NOT denied. (RD-003)
- [x] `StaffOULookupError` thrown (including when Admin SDK credentials are
      absent or misconfigured) → access is denied for the `@jointheleague.org`
      account; HTTP 403 or redirect to error page; session is NOT established.
      The denial is logged at ERROR level. Where possible (i.e., if an audit
      service call can be made without a session), an `AuditEvent` of type
      `auth_denied` is written so the condition appears in the audit trail.
      Operators must be able to observe this failure without inspecting raw
      server logs. (RD-001)
- [x] `GET /staff` returns HTTP 200 with placeholder text for sessions with
      `role=staff`.
- [x] `FakeAdminDirectoryClient` is used in all tests (no real Admin SDK calls).
- [x] All existing tests pass.

## Implementation Plan

### Approach

1. Add the domain-routing branch to `sign-in.handler.ts`.
2. Pass `adminDirClient` into the handler from `passport.config.ts` (the client
   was instantiated in T004).
3. Add `GET /staff` stub route.
4. Test with `FakeAdminDirectoryClient` covering all three domain-routing paths
   and the SDK failure path.

### Files to Modify

- `server/src/services/auth/sign-in.handler.ts` — add OU detection branch.
- `server/src/services/auth/passport.config.ts` — pass `adminDirClient` to
  `signInHandler` on Google callback invocation.
- `server/src/app.ts` or `server/src/routes/staff.ts` — add `/staff` stub route.

### Testing Plan

- `tests/server/routes/auth.google.test.ts` — extend with OU detection cases:
  - `@jointheleague.org` + OU matches → `role=staff`, session correct.
  - `@jointheleague.org` + OU does not match → `role=student`.
  - `@jointheleague.org` + `StaffOULookupError` → 403 / error redirect.
  - `@students.jointheleague.org` → OU check not called, `role=student`.
  - Other domain → OU check not called, `role=student`.
- Use `FakeAdminDirectoryClient` for all test cases; inject via the handler
  factory or a test-time passport config override.

### Documentation Updates

None beyond code. OQ-001, OQ-002, and OQ-003 in `architecture-update.md` have
been resolved as RD-001, RD-002, and RD-003. The `architecture-update.md`
status is `approved`.
