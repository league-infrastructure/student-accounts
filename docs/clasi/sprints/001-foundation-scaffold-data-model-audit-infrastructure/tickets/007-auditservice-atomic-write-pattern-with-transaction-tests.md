---
id: '007'
title: "AuditService \u2014 atomic write pattern with transaction tests"
status: in-progress
use-cases:
- SUC-001
- SUC-002
depends-on:
- '006'
github-issue: ''
todo: ''
---

# AuditService — atomic write pattern with transaction tests

## Description

Create `AuditService` — the cross-cutting module that records an
`AuditEvent` row inside a caller-owned Prisma transaction. This is the
most important architectural piece of the sprint: it enforces the
UC-021 requirement that audit events are atomic with the triggering write.

`AuditService.record` does not open transactions. It accepts a
`Prisma.TransactionClient` from the caller and inserts the `AuditEvent`
row inside that transaction. If the caller's transaction rolls back, the
audit row rolls back with it. If the audit write fails, the caller's
transaction fails.

This ticket also demonstrates the pattern with one concrete end-to-end
example: a UserService method that creates a User and records a
`create_user` audit event in the same transaction.

## Acceptance Criteria

- [x] `server/src/services/audit.service.ts` exports `AuditService` class
      with a single public method:
      `async record(tx: Prisma.TransactionClient, event: AuditEventInput): Promise<void>`
      where `AuditEventInput` is defined in the same file or in
      `contracts/index.ts`.

- [x] `AuditEventInput` type includes:
      `actor_user_id?: number | null`, `action: string`,
      `target_user_id?: number | null`, `target_entity_type?: string`,
      `target_entity_id?: string`, `details?: Record<string, unknown>`.

- [x] `AuditService` is instantiated in `ServiceRegistry` and accessible
      as `registry.audit`.

- [x] `UserService` (or a thin demo method) demonstrates the atomic pattern:
      a method that calls `prisma.$transaction(async (tx) => { ... })`,
      performs a User write, then calls `this.audit.record(tx, { ... })`.
      Both writes succeed or both are rolled back.

- [x] Integration test `tests/server/services/audit.service.test.ts`:
  - [x] Test: successful write — one User is created and one AuditEvent
        row exists with the correct `action`, `actor_user_id` (null for
        system), `target_entity_type` ('User'), `target_entity_id`
        (string of the new user's id), non-null `created_at`.
  - [x] Test: atomic rollback — a transaction that creates a User and
        records an audit event but then throws before committing results
        in zero User rows and zero AuditEvent rows in the database.
  - [x] Test: audit write failure — a transaction where the audit write
        is forced to fail (e.g., by passing an oversized `action` string
        if the column has a length limit, or by using a mock TX that
        throws) results in the outer transaction rolling back the primary
        write as well. (If forcing a write failure is complex, an
        alternative test structure is acceptable: explicitly roll back
        after the audit write and assert both writes are gone.)

- [x] `npm run test:server` passes all tests including the new audit
      service tests.

## Implementation Plan

### AuditService

```typescript
// server/src/services/audit.service.ts (illustrative structure)
export interface AuditEventInput {
  actor_user_id?: number | null;
  action: string;
  target_user_id?: number | null;
  target_entity_type?: string;
  target_entity_id?: string;
  details?: Record<string, unknown>;
}

export class AuditService {
  async record(
    tx: Prisma.TransactionClient,
    event: AuditEventInput
  ): Promise<void> {
    await tx.auditEvent.create({ data: { ...event } });
  }
}
```

The service has no constructor parameters and no state. It uses only the
`tx` parameter passed to `record`.

### ServiceRegistry Integration

Add to `ServiceRegistry`:
```typescript
readonly audit: AuditService;
// in constructor:
this.audit = new AuditService();
```

### Demonstration Pattern in UserService

Add (or replace the existing `create` method with) a method that
illustrates the pattern:

```typescript
async createWithAudit(
  data: { display_name: string; primary_email: string; created_via: CreatedVia },
  actor_user_id: number | null = null
): Promise<User> {
  return this.prisma.$transaction(async (tx) => {
    const user = await UserRepository.create(tx, data);
    await this.audit.record(tx, {
      actor_user_id,
      action: 'create_user',
      target_user_id: user.id,
      target_entity_type: 'User',
      target_entity_id: String(user.id),
    });
    return user;
  });
}
```

### Files to Create

- `server/src/services/audit.service.ts`
- `tests/server/services/audit.service.test.ts`

### Files to Modify

- `server/src/services/service.registry.ts` — add `AuditService`.
- `server/src/services/user.service.ts` — add `createWithAudit` method
  (or update `create`); inject `AuditService` via constructor parameter.

### Testing Plan

Use the factories from T006 to set up test data. Run the three test
scenarios described in the acceptance criteria. Verify with a direct
Prisma query after each test that the database state is as expected.

Verification: `npm run test:server` — all tests pass.

### Documentation Updates

None. The architecture document specifies the pattern in detail.
