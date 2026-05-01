---
id: "001"
title: "Schema Login provenance fields and LoginEvent table"
status: todo
use-cases: [SUC-017-001]
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Schema Login provenance fields and LoginEvent table

## Description

Add the database surface for login provenance.

**Modify `server/prisma/schema.prisma`:**

In the existing `Login` model, add:
- `provider_payload Json?`
- `provider_payload_updated_at DateTime?`
- `directory_metadata Json?`
- back-reference: `events LoginEvent[]`

Add a new model:

```
model LoginEvent {
  id          Int      @id @default(autoincrement())
  login_id    Int
  occurred_at DateTime @default(now())
  payload     Json
  ip          String?
  user_agent  String?

  login Login @relation(fields: [login_id], references: [id], onDelete: Cascade)

  @@index([login_id])
}
```

Run `prisma db push --accept-data-loss --schema=prisma/schema.prisma` from
`server/` (SQLite dev pattern). Then `prisma generate` to update the
Prisma client.

## Acceptance Criteria

- [ ] `Login.provider_payload`, `provider_payload_updated_at`, `directory_metadata` exist on the schema.
- [ ] `LoginEvent` model exists with cascade-delete relation.
- [ ] `prisma db push` succeeds against `data/dev.db`.
- [ ] `prisma generate` regenerates the client; new types visible.
- [ ] Server typechecks (no new errors beyond 21 baseline).
- [ ] Existing test suite still green.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: none.
- **Verification command**: prisma db push, prisma generate, then `npm run test:server`.
