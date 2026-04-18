---
id: '006'
title: "Repository layer \u2014 typed CRUD for all 7 entities with integration tests"
status: done
use-cases:
- SUC-004
depends-on:
- '005'
github-issue: ''
todo: ''
---

# Repository layer — typed CRUD for all 7 entities with integration tests

## Description

Create one repository class per entity in
`server/src/services/repositories/`. Each repository:
- Accepts a `PrismaClient | Prisma.TransactionClient` in its methods
  (not in its constructor — repositories are stateless helpers) so callers
  can compose multiple repository calls inside a single transaction.
- Provides typed CRUD and entity-specific lookup methods.
- Returns typed Prisma model objects (not raw SQL results).

Also create `tests/server/helpers/factories.ts` with factory functions for
all seven entities, used by repository tests and future service tests.

## Acceptance Criteria

- [x] Repository files exist at `server/src/services/repositories/`:
  - `user.repository.ts`
  - `cohort.repository.ts`
  - `login.repository.ts`
  - `external-account.repository.ts`
  - `audit-event.repository.ts`
  - `provisioning-request.repository.ts`
  - `merge-suggestion.repository.ts`

- [x] Each repository accepts a db client (`PrismaClient |
      Prisma.TransactionClient`) as a parameter on every method (not
      stored in constructor state). Example method signature:
      `async findById(db: DbClient, id: number): Promise<User | null>`

- [x] **UserRepository** provides: `create`, `findById`, `findByEmail`,
      `findAll` (with optional role filter, optional cohort filter),
      `update`, `delete`.

- [x] **CohortRepository** provides: `create`, `findById`, `findByName`,
      `findAll`, `update`, `delete`.

- [x] **LoginRepository** provides: `create`, `findById`,
      `findByProvider(provider, provider_user_id)`,
      `findAllByUser(user_id)`, `delete`.

- [x] **ExternalAccountRepository** provides: `create`, `findById`,
      `findAllByUser(user_id)`,
      `findActiveByUserAndType(user_id, type)`,
      `updateStatus(id, status)`, `delete`.

- [x] **AuditEventRepository** provides: `create(db, event)`,
      `findById`, `findByTargetUser(user_id, limit?)`,
      `findByActor(actor_user_id, limit?)`,
      `findByAction(action, limit?)`.

- [x] **ProvisioningRequestRepository** provides: `create`, `findById`,
      `findByUser(user_id)`, `findPending`, `updateStatus(id, status,
      decided_by, decided_at)`.

- [x] **MergeSuggestionRepository** provides: `create`, `findById`,
      `findPending`, `findByPair(user_a_id, user_b_id)`,
      `updateStatus(id, status, decided_by?, decided_at?)`.

- [x] `tests/server/helpers/factories.ts` exports:
      `makeUser`, `makeCohort`, `makeLogin`, `makeExternalAccount`,
      `makeAuditEvent`, `makeProvisioningRequest`, `makeMergeSuggestion`.
      Each factory inserts directly via the Prisma client and returns the
      created row with all fields.

- [x] Integration test files exist at `tests/server/repositories/` for all
      7 entities. Each test file covers at minimum:
      - create + findById (hit)
      - findById (miss) → returns null
      - update
      - delete
      - At least one entity-specific lookup (e.g., `findByProvider` for
        Login, `findByPair` for MergeSuggestion)

- [x] FK constraint violations surface as caught errors (not unhandled
      promise rejections). Repositories let Prisma errors propagate to
      callers unchanged; callers (services) decide whether to re-wrap as
      `ConflictError`. This is documented in each repository file's JSDoc.

- [x] `npm run test:server` passes all new and existing tests.

## Implementation Plan

### Repository Pattern

Repositories are stateless. Each exported function (or class method, either
is acceptable) takes the db client as its first parameter:

```typescript
// Either functional style:
export async function findById(
  db: PrismaClient | Prisma.TransactionClient,
  id: number
): Promise<User | null> {
  return db.user.findUnique({ where: { id } });
}

// Or class style with static methods:
export class UserRepository {
  static async findById(db: DbClient, id: number) { ... }
}
```

Choose one style and apply it consistently across all repositories. The
functional style is simpler; the class style allows grouping. Either works.

### Files to Create

- `server/src/services/repositories/user.repository.ts`
- `server/src/services/repositories/cohort.repository.ts`
- `server/src/services/repositories/login.repository.ts`
- `server/src/services/repositories/external-account.repository.ts`
- `server/src/services/repositories/audit-event.repository.ts`
- `server/src/services/repositories/provisioning-request.repository.ts`
- `server/src/services/repositories/merge-suggestion.repository.ts`
- `tests/server/helpers/factories.ts`
- `tests/server/repositories/user.repository.test.ts`
- `tests/server/repositories/cohort.repository.test.ts`
- `tests/server/repositories/login.repository.test.ts`
- `tests/server/repositories/external-account.repository.test.ts`
- `tests/server/repositories/audit-event.repository.test.ts`
- `tests/server/repositories/provisioning-request.repository.test.ts`
- `tests/server/repositories/merge-suggestion.repository.test.ts`

### Files to Modify

- `server/src/services/repositories/index.ts` (create) — barrel export for
  all repository modules.
- `tests/server/global-setup.ts` — verify the table truncation list covers
  all 7 new entity tables (the existing dynamic introspection approach should
  handle this automatically; confirm).

### Testing Plan

Each repository test file:
1. Uses the factory helpers from `factories.ts` to set up prerequisite rows.
2. Calls the repository method under test.
3. Asserts on the returned value or a subsequent findById call.
4. Tests run sequentially within a file (Vitest `fileParallelism: false` is
   already set in `vitest.config.ts`).

Verification: `npm run test:server` — all tests pass including the new
repository tests.

### Documentation Updates

None. The architecture document already specifies the repository pattern.
