---
id: "001"
title: "Schema migration: add scheduled_delete_at to ExternalAccount"
status: done
use-cases: [SUC-005, SUC-007]
depends-on: []
---

# Schema migration: add scheduled_delete_at to ExternalAccount

## Description

Add a nullable `DateTime` column `scheduled_delete_at` to the `ExternalAccount`
Prisma model. This column records when a removed Workspace account should be
hard-deleted from Google Workspace (typically 3 days after removal). The column
is set by `ExternalAccountLifecycleService.remove` for workspace accounts and
read by `WorkspaceDeleteJob`.

The column is nullable and defaults to null, making this a backward-compatible
migration. All existing rows remain valid with null.

## Acceptance Criteria

- [x] `server/prisma/schema.prisma` updated: `scheduled_delete_at DateTime?` added to the ExternalAccount model.
- [x] Prisma migration generated and applied to dev SQLite database.
- [x] Prisma client regenerated: `scheduled_delete_at` field is accessible on ExternalAccount TypeScript type.
- [x] Existing ExternalAccount repository and service tests continue to pass unchanged.
- [x] Migration file committed in `server/prisma/migrations/`.

## Implementation Plan

### Approach

1. Add `scheduled_delete_at DateTime?` to the ExternalAccount model in `server/prisma/schema.prisma`.
2. Run `npx prisma db push` in the server directory (dev uses db push per project conventions — no migration history in dev).
3. Run `npx prisma generate` to regenerate the client.
4. Verify the TypeScript type includes `scheduled_delete_at: Date | null`.

### Files to modify

- `server/prisma/schema.prisma` — add `scheduled_delete_at DateTime?` to ExternalAccount.

### Testing plan

- Run `npm test` from the project root after regenerating the client. All existing repository and service tests should continue to pass — no test touches `scheduled_delete_at` yet.

### Documentation updates

None required beyond the schema change itself.
