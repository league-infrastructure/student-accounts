---
id: "005"
title: "Add GET /admin/audit-log route with filters and pagination"
status: todo
use-cases: [SUC-009-008]
depends-on: []
github-issue: ""
todo: ""
---

# Add GET /admin/audit-log route with filters and pagination

## Description

Administrators need to search the AuditEvent table by actor, target user,
action type, and date range. The existing AuditEvent indexes
(`actor_user_id+created_at`, `target_user_id+created_at`, `action+created_at`)
make filtered queries efficient without schema changes. This ticket implements
the server-side query endpoint with page-based pagination and actor/target name
resolution via JOIN.

## Acceptance Criteria

- [ ] `GET /api/admin/audit-log` accepts optional query params: `actorId`
      (integer), `targetUserId` (integer), `action` (string), `from` (ISO date),
      `to` (ISO date), `page` (integer, default 1), `pageSize` (integer,
      default 50, max 200).
- [ ] Response: `{ total, page, pageSize, items: [{ id, createdAt, actorId,
      actorName, action, targetUserId, targetUserName, targetEntityType,
      targetEntityId, details }] }`.
- [ ] Items are returned in descending `created_at` order.
- [ ] `actorName` and `targetUserName` are resolved from the User table;
      fall back to `null` if the user has been soft-deleted or FK is null.
- [ ] Each filter param is optional; if omitted, that dimension is not
      constrained.
- [ ] `from` / `to` are inclusive date range bounds on `created_at`.
- [ ] Returns 400 for invalid param values (non-integer page, malformed date).
- [ ] Requires admin role (inherited from `adminRouter`).
- [ ] Server tests: no filters returns all events paginated; filter by action
      returns only matching; filter by actorId returns only that actor's events;
      date range filter returns events within range; page 2 returns correct
      offset.

## Implementation Plan

**Files to create:**
- `server/src/routes/admin/audit-log.ts` — new `adminAuditLogRouter`.

**Files to modify:**
- `server/src/routes/admin/index.ts` — mount `adminAuditLogRouter`.

**Router sketch:**
```typescript
adminAuditLogRouter.get('/audit-log', async (req, res, next) => {
  try {
    const actorId = req.query.actorId ? parseInt(req.query.actorId as string) : undefined;
    const targetUserId = req.query.targetUserId ? parseInt(req.query.targetUserId as string) : undefined;
    const action = req.query.action as string | undefined;
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt((req.query.pageSize as string) ?? '50')));

    const where = {
      ...(actorId !== undefined && { actor_user_id: actorId }),
      ...(targetUserId !== undefined && { target_user_id: targetUserId }),
      ...(action && { action }),
      ...(from || to) && { created_at: { ...(from && { gte: from }), ...(to && { lte: to }) } },
    };

    const [total, events] = await prisma.$transaction([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { display_name: true } },
          target: { select: { display_name: true } },
        },
      }),
    ]);

    res.json({
      total, page, pageSize,
      items: events.map(e => ({
        id: e.id,
        createdAt: e.created_at,
        actorId: e.actor_user_id,
        actorName: e.actor?.display_name ?? null,
        action: e.action,
        targetUserId: e.target_user_id,
        targetUserName: e.target?.display_name ?? null,
        targetEntityType: e.target_entity_type,
        targetEntityId: e.target_entity_id,
        details: e.details,
      })),
    });
  } catch (err) { next(err); }
});
```

**Testing plan:**
- New test file: `tests/server/admin/audit-log.test.ts`
- Seed 10 AuditEvents with varying actors, actions, and dates.
- Cases as listed in acceptance criteria above.

**Documentation updates:** None required.
