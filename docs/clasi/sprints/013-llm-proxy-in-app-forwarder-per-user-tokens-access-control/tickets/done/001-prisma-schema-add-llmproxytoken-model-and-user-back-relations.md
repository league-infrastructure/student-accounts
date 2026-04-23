---
id: '001'
title: "Prisma schema \u2014 add LlmProxyToken model and User back-relations"
status: done
use-cases:
- SUC-013-001
- SUC-013-002
- SUC-013-003
- SUC-013-005
depends-on: []
github-issue: ''
todo: llm-proxy-integration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Prisma schema — add LlmProxyToken model and User back-relations

## Description

Add the `LlmProxyToken` model to `server/prisma/schema.prisma` so the
rest of the sprint has a persistence layer to build against. This is
the root of the dependency graph — every other ticket imports the
generated Prisma client types.

Per the architecture update:

- One new `LlmProxyToken` model (columns listed below).
- Two back-relations on `User`:
  `llm_proxy_tokens: LlmProxyToken[]` and
  `llm_proxy_tokens_granted: LlmProxyToken[] @relation("LlmProxyGranter")`.
- Two indexes on `LlmProxyToken` plus the unique index on
  `token_hash`.
- `user_id` FK has `onDelete: Cascade`; `granted_by` FK has
  `onDelete: SetNull`.
- Update `ServiceRegistry.clearAll()` to `deleteMany()` the new table
  before `user.deleteMany()` so the FK-safe teardown order is
  preserved.
- Run `prisma db push` against dev (`DATABASE_URL` from .env) AND
  against test (`DATABASE_URL="file:./data/test.db"` per Sprint 012
  precedent). Regenerate the Prisma client so `generated/prisma`
  picks up the new types.

Model:

```prisma
model LlmProxyToken {
  id            Int       @id @default(autoincrement())
  user_id       Int
  token_hash    String    @unique
  expires_at    DateTime
  token_limit   Int
  tokens_used   Int       @default(0)
  request_count Int       @default(0)
  granted_by    Int?
  granted_at    DateTime  @default(now())
  revoked_at    DateTime?
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt

  user    User  @relation(fields: [user_id],    references: [id], onDelete: Cascade)
  granter User? @relation("LlmProxyGranter", fields: [granted_by], references: [id], onDelete: SetNull)

  @@index([user_id])
  @@index([user_id, revoked_at, expires_at])
}
```

User additions:

```prisma
llm_proxy_tokens         LlmProxyToken[]
llm_proxy_tokens_granted LlmProxyToken[] @relation("LlmProxyGranter")
```

## Acceptance Criteria

- [x] `server/prisma/schema.prisma` contains the `LlmProxyToken`
      model and the two `User` back-relations exactly as specified.
- [x] `npx prisma generate` completes with no errors and the
      generated client exports `LlmProxyToken`.
- [x] `npx prisma db push` succeeds against the dev DB.
- [x] `DATABASE_URL="file:./data/test.db" npx prisma db push` (from
      `server/`) succeeds against the test DB.
- [x] `ServiceRegistry.clearAll()` has `await (p as any).llmProxyToken.deleteMany()` placed before `user.deleteMany()`.
- [x] `npm run test:server` still runs; no tests regress from the
      schema change. Pre-existing flakes are acceptable.
- [x] `npm run test:client` still runs; pre-existing drift
      (UserDetailPanel / Cohorts / LoginPage / UsersPanel) remains
      the only failures.

## Testing

- **Existing tests to run**: `npm run test:server` — watch for
  anything that explodes on a missing `llmProxyToken` table (the
  teardown loop in `global-setup.ts` iterates `sqlite_master` so it
  will pick up the new table automatically).
- **New tests to write**: None in this ticket — the model is covered
  indirectly by the T002 service tests.
- **Verification command**: `cd server && npx prisma generate && npx prisma db push` then `npm run test:server`.
