---
status: pending
priority: high
source: inventory app (server/src/services/audit.service.ts, server/prisma/schema.prisma)
---

# Field-Level Audit Logging

Add a comprehensive audit trail that records every write operation: who
changed what field, from what value to what value, when, and through which
interface.

## Why

Any application managing real data needs an audit trail. When something
goes wrong — a record is deleted, a role is changed, data is corrupted —
you need to know who did it, when, and what the previous value was. This
is table-stakes for production apps.

## Schema

```prisma
enum AuditSource {
  UI
  IMPORT
  API
  MCP
  SYSTEM
}

model AuditLog {
  id         Int         @id @default(autoincrement())
  userId     Int?
  user       User?       @relation(fields: [userId], references: [id])
  objectType String      // e.g., "User", "Channel", "Message", "Config"
  objectId   String      // ID of the changed object (as string for flexibility)
  field      String      // which field changed
  oldValue   String?     // previous value (null for creates)
  newValue   String?     // new value (null for deletes)
  source     AuditSource @default(UI)
  createdAt  DateTime    @default(now())

  @@index([objectType, objectId])
  @@index([userId])
  @@index([createdAt])
}
```

## Service Implementation

Create `server/src/services/audit.service.ts`:

```typescript
export class AuditService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Write one or more audit log entries.
   */
  async write(entries: AuditEntry | AuditEntry[]): Promise<void> {
    const arr = Array.isArray(entries) ? entries : [entries];
    if (arr.length === 0) return;
    await this.prisma.auditLog.createMany({ data: arr });
  }

  /**
   * Compare two versions of an object and log all changed fields.
   * Returns the entries written (useful for testing).
   */
  async diff(
    userId: number | null,
    objectType: string,
    objectId: string | number,
    oldObj: Record<string, any>,
    newObj: Record<string, any>,
    fields: string[],
    source: AuditSource = 'UI'
  ): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    for (const field of fields) {
      const oldVal = String(oldObj[field] ?? '');
      const newVal = String(newObj[field] ?? '');
      if (oldVal !== newVal) {
        entries.push({
          userId,
          objectType,
          objectId: String(objectId),
          field,
          oldValue: oldVal || null,
          newValue: newVal || null,
          source,
        });
      }
    }
    if (entries.length > 0) {
      await this.write(entries);
    }
    return entries;
  }
}
```

## Integration with Services

Every service that performs writes should accept an `AuditService` and
call `diff()` after mutations:

```typescript
// Example in UserService:
async updateRole(userId: number, newRole: UserRole, actorId: number) {
  const old = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const updated = await this.prisma.user.update({
    where: { id: userId },
    data: { role: newRole },
  });
  await this.audit.diff(actorId, 'User', userId, old, updated, ['role']);
  return updated;
}
```

## Source Tracking

The `ServiceRegistry` should accept a `source` parameter that propagates
to all audit entries:

```typescript
const uiRegistry = ServiceRegistry.create(prisma, 'UI');
const mcpRegistry = ServiceRegistry.create(prisma, 'MCP');
const apiRegistry = ServiceRegistry.create(prisma, 'API');
```

Route handlers use the UI registry. The MCP handler uses the MCP registry.
Token-authenticated API routes use the API registry. This way audit logs
automatically record whether a change came from a human in the browser,
an AI via MCP, or an external API call.

## Admin UI

Add an Audit Log panel to the admin dashboard:

- Queryable by object type, object ID, user, date range
- Shows field, old value → new value, source, timestamp
- Paginated with newest-first default
- Route: `GET /api/admin/audit-log?objectType=&objectId=&userId=&from=&to=&page=&limit=`

## Reference Files

- Inventory: `server/src/services/audit.service.ts`
- Inventory: `server/src/services/service.registry.ts` (source propagation)
- Inventory: `server/prisma/schema.prisma` — `AuditLog` model

## Verification

- Creating a user generates audit entries for each populated field
- Updating a user role generates an entry with old and new values
- Audit source correctly reflects UI vs MCP vs API
- Admin audit log panel displays entries with filtering
- Audit entries are not created for unchanged fields
