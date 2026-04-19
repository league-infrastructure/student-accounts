---
id: "006"
title: "Admin role assignment — ADMIN_EMAILS env var check in sign-in handler"
status: todo
use-cases: [UC-005, UC-012]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# Admin role assignment — ADMIN_EMAILS env var check in sign-in handler

## Description

The admin provisioning-requests and cohort management pages (T008, T009)
are protected by `requireRole('admin')`. No flow currently assigns
`role=admin` to any user. This ticket adds admin role assignment.

**Design decision (OQ-001 resolution):** Use the `ADMIN_EMAILS` environment
variable — a comma-separated list of `@jointheleague.org` email addresses.
When a Google sign-in resolves a `@jointheleague.org` account whose email
is in this list, the sign-in handler sets `user.role = 'admin'` and stores
`session.role = 'admin'`.

The check runs after the existing staff OU check (step 4 in the sign-in
handler flow). Admin overrides staff: if the email is in `ADMIN_EMAILS`, the
role is `admin` regardless of OU membership.

`ADMIN_EMAILS` is the minimal viable solution. Future sprints may replace
it with Google OU detection without changing `requireRole('admin')` or
any admin route handlers.

## Acceptance Criteria

- [ ] `ADMIN_EMAILS` environment variable is parsed at module load time in the
      sign-in handler (or a shared config module): split by comma, trim
      whitespace, lowercase for comparison.
- [ ] Sign-in handler step for `@jointheleague.org` accounts: after the staff
      OU check, if `user.primary_email.toLowerCase()` is in the `ADMIN_EMAILS`
      set, call `UserService.update(user.id, { role: 'admin' })` and set
      `session.role = 'admin'`.
- [ ] If `ADMIN_EMAILS` is empty or absent, no user gets `role=admin` via this
      path (no default admin account).
- [ ] If a user is in `ADMIN_EMAILS`, their role is set to `admin` even if the
      staff OU check would have assigned `staff`.
- [ ] For non-`@jointheleague.org` accounts (students, GitHub sign-ins), the
      `ADMIN_EMAILS` check is never run.
- [ ] Session shape is unchanged — `session.role` is still `UserRole` (now
      `'admin'` is a valid value it can hold; it was already in the `UserRole`
      enum from Sprint 001).
- [ ] Integration tests (using `FakeGoogleWorkspaceAdminClient`):
      - Email in `ADMIN_EMAILS` → `session.role = 'admin'`.
      - Email NOT in `ADMIN_EMAILS`, in staff OU → `session.role = 'staff'`.
      - Email NOT in `ADMIN_EMAILS`, NOT in staff OU → `session.role = 'student'`.
      - `ADMIN_EMAILS` env var absent → nobody gets admin role.
- [ ] `requireRole('admin')` middleware continues to work unchanged (it reads
      `session.role`; the value `'admin'` was already in the enum).
- [ ] `npm test` passes.

## Implementation Plan

### Approach

Modify `server/src/services/auth/sign-in.handler.ts`. Parse `ADMIN_EMAILS`
once (at module initialization or on first call; module-level constant is
fine). Add the check as a new conditional branch within the
`@jointheleague.org` handling block, after the staff OU check.

`ADMIN_EMAILS` parsing: `(process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)`.
Store as a `Set<string>` for O(1) lookup.

### Files to Modify

- `server/src/services/auth/sign-in.handler.ts` — add admin role check.
- `config/dev/secrets.env.example` and `config/prod/secrets.env.example` —
  add `ADMIN_EMAILS` with a comment.

### Testing Plan

Extend existing Sprint 002 sign-in handler integration tests:
- Add `ADMIN_EMAILS` to test env for specific test cases.
- Test the three role outcomes described in acceptance criteria.
- Test that students with a matching email format but `@students.jointheleague.org`
  domain are not elevated (domain check ensures this naturally).

### Documentation Updates

Add `ADMIN_EMAILS` to the secrets tables in `config/dev/secrets.env.example`
and `config/prod/secrets.env.example`.
