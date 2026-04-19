---
id: "010"
title: "Admin API routes — add and remove Login on user's behalf"
status: done
use-cases: [SUC-002, SUC-003]
depends-on: ["003"]
---

# Admin API routes — add and remove Login on user's behalf

## Description

Add two admin API routes for managing Logins on behalf of a user:

| Method | Path | Description |
|---|---|---|
| POST | `/admin/users/:id/logins` | Add a Login to the user |
| DELETE | `/admin/users/:id/logins/:loginId` | Remove a Login from the user |

Both routes delegate to the existing `LoginService`. The add route also
calls the Pike13 write-back stub when `provider=github`.

### POST /admin/users/:id/logins — request body

```json
{
  "provider": "google" | "github",
  "providerUserId": "string",
  "providerEmail": "string (optional)",
  "providerUsername": "string (optional, used for github)"
}
```

The actorId for the audit event is `req.user.id` (the admin).

## Acceptance Criteria

- [x] POST /admin/users/:id/logins creates the Login via LoginService.create.
- [x] POST /admin/users/:id/logins: if provider=github, calls pike13WritebackStub.githubHandle.
- [x] POST /admin/users/:id/logins returns 201 with the created Login.
- [x] POST /admin/users/:id/logins: 409 when providerUserId already exists on another user.
- [x] POST /admin/users/:id/logins: 400 when provider or providerUserId is missing.
- [x] POST /admin/users/:id/logins: 403 for non-admin.
- [x] DELETE /admin/users/:id/logins/:loginId deletes the Login via LoginService.delete.
- [x] DELETE returns 204 on success.
- [x] DELETE: 422 when removing would leave user with zero logins.
- [x] DELETE: 404 when loginId does not exist.
- [x] DELETE: 403 for non-admin.
- [x] AuditEvents recorded for both operations (via LoginService — no extra audit calls needed in route).
- [x] Integration tests pass.

## Implementation Plan

### Approach

Add both endpoints to `server/src/routes/admin/users.ts` alongside the
existing user management routes. The add-login route:

```
1. Parse userId and body.
2. Call loginService.create(userId, provider, providerUserId, providerEmail, actorId, providerUsername).
3. If provider === 'github': await pike13WritebackStub.githubHandle(userId, providerUsername ?? providerUserId).
4. Return 201 with login record.
```

The remove-login route:

```
1. Parse userId and loginId.
2. Verify the login belongs to this user (load it, check user_id).
3. Call loginService.delete(loginId, actorId).
4. Return 204.
```

### Files to modify

- `server/src/routes/admin/users.ts` — add the two endpoints.

### Testing plan

Route integration tests (extend `tests/server/routes/admin/users.test.ts`):
- Add google login: 201, Login created, audit event, stub NOT called.
- Add github login: 201, Login created, audit event, githubHandle stub called.
- Add login duplicate: 409.
- Add login missing body fields: 400.
- Add login non-admin: 403.
- Remove login: 204, Login deleted, audit event.
- Remove last login: 422.
- Remove login wrong user: 404.
- Remove login non-admin: 403.

### Documentation updates

None.
