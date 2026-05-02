---
id: "001"
title: "Server — widen GET /api/account to all authenticated roles"
status: todo
use-cases:
  - SUC-022-001
  - SUC-022-002
  - SUC-022-003
depends-on: []
github-issue: ""
todo: backlog-unshipped-follow-ups-from-sprints-020-and-021.md
# completes_todo: false because the backlog TODO also covers items B, C, D
# which are deferred to sprint 023. Archival is suppressed here; sprint 023
# planning will handle final archival of the TODO.
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server — widen GET /api/account to all authenticated roles

## Description

`GET /api/account` currently requires `requireRole('student')` (line 35 of
`server/src/routes/account.ts`). Staff and admin users receive a 403, which
causes the client to suppress the entire identity surface on the Account page.

This ticket removes `requireRole('student')` from `GET /api/account` and from
`DELETE /api/account/logins/:id` (which has the same guard). The handlers
already read data via `userId` from the session; cohort, workspaceTempPassword,
and llmProxyEnabled return null/false/empty naturally for users who have no
such records. No business-logic changes are required.

The comment block at the top of `account.ts` is updated to reflect the widened
access contract.

## Acceptance Criteria

- [ ] `GET /api/account` with a staff session returns 200 and a valid
      `{ profile, logins, externalAccounts }` response body.
- [ ] `GET /api/account` with an admin session returns 200 and a valid
      `{ profile, logins, externalAccounts }` response body.
- [ ] `profile.cohort` is null for non-students (no cohort assigned).
- [ ] `profile.workspaceTempPassword` is null for non-students.
- [ ] `profile.llmProxyEnabled` is false for non-students.
- [ ] `DELETE /api/account/logins/:id` with a staff session and the staff
      user's own login ID returns 204.
- [ ] `DELETE /api/account/logins/:id` with a staff session and a login ID
      belonging to another user returns 404 (ownership check unchanged).
- [ ] `GET /api/account` with an unauthenticated request still returns 401
      (requireAuth remains in place).
- [ ] Existing server test suite passes at or above baseline.

## Implementation Plan

### Approach

Two surgical edits in `server/src/routes/account.ts`:

1. On `GET /account`: change the middleware chain from
   `[requireAuth, requireRole('student'), async handler]` to
   `[requireAuth, async handler]`.

2. On `DELETE /account/logins/:id`: same — remove `requireRole('student')`
   from the middleware chain.

3. Update the JSDoc comment at the top of the file. The old comment states
   "Every handler applies requireAuth + requireRole('student'). Requests from
   users with role=staff or role=admin return 403." Replace with an accurate
   description of the widened contract.

No changes to handler logic, service calls, or response shape.

### Files to Modify

- `server/src/routes/account.ts` — remove `requireRole('student')` from
  `GET /account` and `DELETE /account/logins/:id`; update file-level JSDoc.

### Files to Leave Unchanged

- `server/src/routes/account.ts` — `GET /account/llm-proxy` retains its
  `requireRole('student')` guard (LLM proxy is student-only).
- All service files — no business-logic changes needed.

### New Tests

Add a new describe block in `tests/server/routes/account.test.ts` (or the
equivalent server-side account test file — locate it first):

```
describe('GET /api/account — non-student roles', () => {
  it('returns 200 for staff role', async () => { ... })
  it('returns 200 for admin role', async () => { ... })
  it('returns null cohort for non-student', async () => { ... })
  it('returns null workspaceTempPassword for non-student', async () => { ... })
  it('returns false llmProxyEnabled for non-student', async () => { ... })
})

describe('DELETE /api/account/logins/:id — staff role', () => {
  it('removes own login and returns 204', async () => { ... })
})
```

Use the project's existing test-user factory pattern (look at nearby test
files for the helper used to create session-authenticated requests for
specific roles).

### Testing Plan

Run `npm run test:server` after the change. Confirm:
- New tests pass.
- Existing account-route tests pass (they cover student role specifically).

### Documentation Updates

Update the JSDoc block at the top of `server/src/routes/account.ts` to
accurately reflect the widened access contract.
