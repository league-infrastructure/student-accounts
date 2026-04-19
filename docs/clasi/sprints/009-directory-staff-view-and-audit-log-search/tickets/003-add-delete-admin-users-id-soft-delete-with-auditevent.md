---
id: "003"
title: "Add DELETE /admin/users/:id (soft-delete) with AuditEvent"
status: todo
use-cases: [SUC-009-002, SUC-009-003]
depends-on: []
github-issue: ""
todo: ""
---

# Add DELETE /admin/users/:id (soft-delete) with AuditEvent

## Description

The row-actions Delete and bulk-delete actions in the Users panel require a
server-side delete endpoint. Use soft-delete (`is_active=false`) to preserve
relational data (AuditEvents, Logins, ExternalAccounts) rather than cascading
hard deletion. An AuditEvent with `action=delete_user` is recorded.

## Acceptance Criteria

- [ ] `DELETE /api/admin/users/:id` sets `is_active=false` and `updated_at=now`
      on the target User.
- [ ] Records an AuditEvent: `action='delete_user'`, `actor_user_id=req.user.id`,
      `target_user_id=id`.
- [ ] Returns 200 with `{ success: true }` on success.
- [ ] Returns 404 if the user does not exist.
- [ ] Returns 403 if the actor attempts to delete their own account
      (`id === req.user.id`).
- [ ] The deleted user no longer appears in `GET /admin/users` (filtered by
      `is_active=true`).
- [ ] Route requires admin role (inherited from `adminRouter`).
- [ ] Server tests cover: successful delete, self-delete blocked (403),
      user not found (404).

## Implementation Plan

**Files to modify:**
- `server/src/routes/admin/users.ts` — add `DELETE /users/:id` handler.

**Handler sketch:**
```typescript
adminUsersRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });
    const actorId = req.user!.id;
    if (id === actorId) return res.status(403).json({ error: 'Cannot delete own account' });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { is_active: false } });
      await tx.auditEvent.create({
        data: { action: 'delete_user', actor_user_id: actorId, target_user_id: id },
      });
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

**Testing plan:**
- Add to `tests/server/admin/users.test.ts`:
  - DELETE own account → 403.
  - DELETE nonexistent user → 404.
  - DELETE valid other user → 200, `is_active=false`, AuditEvent created.
  - Verify deleted user absent from GET /admin/users response.

**Documentation updates:** None required.
