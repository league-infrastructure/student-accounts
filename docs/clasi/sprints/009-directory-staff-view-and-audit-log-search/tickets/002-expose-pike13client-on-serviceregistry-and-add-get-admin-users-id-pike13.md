---
id: "002"
title: "Expose pike13Client on ServiceRegistry and add GET /admin/users/:id/pike13"
status: todo
use-cases: [SUC-009-005]
depends-on: []
github-issue: ""
todo: ""
---

# Expose pike13Client on ServiceRegistry and add GET /admin/users/:id/pike13

## Description

The UserDetailPanel needs a live Pike13 record snippet for users who have a
Pike13 ExternalAccount. This requires:

1. Exposing `pike13Client: Pike13ApiClient` as a property on `ServiceRegistry`
   (matching the `googleClient` precedent), so route handlers can call
   `req.services.pike13Client.getPerson(...)`.
2. A new route `GET /admin/users/:id/pike13` that: reads the user's Pike13
   ExternalAccount's `external_id`, calls `getPerson`, and returns a structured
   response with fail-soft error handling.

## Acceptance Criteria

- [ ] `ServiceRegistry` exposes a `readonly pike13Client: Pike13ApiClient`
      property (the same `Pike13ApiClientImpl` instance already constructed
      inside the registry constructor).
- [ ] `GET /api/admin/users/:id/pike13` returns `{ present: false }` when the
      user has no Pike13 ExternalAccount.
- [ ] `GET /api/admin/users/:id/pike13` returns
      `{ present: true, person: { display_name, email, phone, account_status,
      league_email, github_username } }` on success.
- [ ] `GET /api/admin/users/:id/pike13` returns
      `{ present: true, error: string }` when the Pike13 API call fails
      (network error, non-2xx response), without throwing a 500.
- [ ] Returns 404 if the user does not exist.
- [ ] Route requires admin role (inherited from `adminRouter` guard).
- [ ] Server tests cover present/absent/api-error paths using a
      `FakePike13ApiClient` or Jest mock.

## Implementation Plan

**Approach:** Two-step. First expose the client on the registry. Then add the
route handler.

**Files to modify:**
- `server/src/services/service.registry.ts` — promote the local `pike13Client`
  variable to `readonly pike13Client: Pike13ApiClient`; assign in constructor
  before passing to `Pike13SyncService`.
- `server/src/routes/admin/users.ts` — add the new GET handler.
- `server/src/routes/admin/index.ts` — no change needed (existing
  `adminUsersRouter` is already mounted).

**Route handler sketch:**
```typescript
adminUsersRouter.get('/users/:id/pike13', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const user = await prisma.user.findUnique({
      where: { id },
      include: { external_accounts: { where: { type: 'pike13' } } },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pike13Acct = user.external_accounts[0];
    if (!pike13Acct?.external_id) return res.json({ present: false });
    try {
      const person = await req.services.pike13Client.getPerson(pike13Acct.external_id);
      return res.json({ present: true, person });
    } catch (err: any) {
      return res.json({ present: true, error: err.message ?? 'Pike13 API error' });
    }
  } catch (err) {
    next(err);
  }
});
```

**Testing plan:**
- New test file: `tests/server/admin/users-pike13.test.ts`
- Cases: (1) user has no pike13 account → `{ present: false }`; (2) user has
  pike13 account, fake client succeeds → `{ present: true, person: {...} }`;
  (3) user has pike13 account, fake client throws → `{ present: true, error }`.
- Inject a fake/mock `Pike13ApiClient` via `ServiceRegistry.create(...)` overload
  or by monkey-patching `req.services` in the test.

**Documentation updates:** None required.
