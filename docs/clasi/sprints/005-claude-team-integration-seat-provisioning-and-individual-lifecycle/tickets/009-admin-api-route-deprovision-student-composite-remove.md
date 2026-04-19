---
id: "009"
title: "Admin API route — deprovision student (composite remove)"
status: todo
use-cases: [SUC-006]
depends-on: ["005"]
---

# Admin API route — deprovision student (composite remove)

## Description

Implement `POST /admin/users/:id/deprovision` — the composite route that
removes all workspace and claude ExternalAccounts for a departing student.

The route:
1. Loads all active ExternalAccounts for the user.
2. Filters to workspace and claude types (skips pike13).
3. For each applicable account, calls `ExternalAccountLifecycleService.remove`.
   Each call runs in its own `prisma.$transaction`.
4. Collects successes and failures per-account.
5. Returns a structured response with `succeeded` and `failed` lists.

This is a fail-soft composite: API failures on individual accounts are
collected and reported but do not block removal of other accounts.

## Acceptance Criteria

- [ ] POST /admin/users/:id/deprovision iterates all active workspace and claude accounts.
- [ ] Pike13 accounts are skipped.
- [ ] Each account removed via ExternalAccountLifecycleService.remove.
- [ ] Per-account failure does not stop the composite — other accounts continue.
- [ ] Response body: `{ succeeded: [accountId, ...], failed: [{ accountId, error }, ...] }`.
- [ ] HTTP 200 returned even if some accounts failed (partial success). HTTP 207 is acceptable.
- [ ] HTTP 404 if user does not exist.
- [ ] HTTP 403 for non-admin callers.
- [ ] Multiple AuditEvents emitted (one per removed account — emitted by service layer).
- [ ] Integration tests pass.

## Implementation Plan

### Approach

Add the deprovision endpoint to `server/src/routes/admin/users.ts`. The route
handler coordinates the composite operation:

```
1. Look up user (404 if not found).
2. Load ExternalAccounts (findAllByUser).
3. Filter: type in ['workspace', 'claude'] AND status in ['active', 'suspended'].
4. For each eligible account:
   try:
     await prisma.$transaction(tx => lifecycleService.remove(account.id, actorId, tx))
     succeeded.push(account.id)
   catch (err):
     failed.push({ accountId: account.id, error: err.message })
5. Return { succeeded, failed }
```

### Files to modify

- `server/src/routes/admin/users.ts` — add POST /users/:id/deprovision endpoint.

### Testing plan

Integration tests (extend `tests/server/routes/admin/users.test.ts`):
- User with workspace + claude accounts: both removed, 2 successes.
- User with only pike13 account: no-op, 0 succeeded, 0 failed, 200.
- One account's API call fails: failed list populated, other account still removed.
- Non-admin: 403.
- User not found: 404.

### Documentation updates

None.
