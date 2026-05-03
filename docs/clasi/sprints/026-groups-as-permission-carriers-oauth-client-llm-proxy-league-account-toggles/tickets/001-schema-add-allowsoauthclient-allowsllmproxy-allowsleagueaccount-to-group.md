---
id: '001'
title: 'Schema: add allowsOauthClient, allowsLlmProxy, allowsLeagueAccount to Group'
status: todo
use-cases:
  - SUC-001
depends-on: []
github-issue: ''
todo: groups-as-permission-carriers.md
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Schema: add allowsOauthClient, allowsLlmProxy, allowsLeagueAccount to Group

## Description

Add three boolean permission columns to the `Group` model in `server/prisma/schema.prisma`.
These columns make the Group entity the primary permission carrier for three features:
OAuth client registration, LLM proxy access, and League Account (Workspace) provisioning.

All three default to `false` so existing Group rows are not affected.

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma` Group model has `allowsOauthClient Boolean @default(false)`.
- [ ] `server/prisma/schema.prisma` Group model has `allowsLlmProxy Boolean @default(false)`.
- [ ] `server/prisma/schema.prisma` Group model has `allowsLeagueAccount Boolean @default(false)`.
- [ ] `prisma db push` (or migration generate) completes without errors on the dev database.
- [ ] Prisma-generated client exposes the three fields on the `Group` type.
- [ ] Existing Group rows in the dev database retain their data; all three new fields are `false`.
- [ ] All existing server tests pass after the schema change.

## Implementation Plan

### Approach

Edit `server/prisma/schema.prisma` to add three fields inside the `model Group` block,
after the existing `signup_passphrase_created_by` field. Then regenerate the Prisma
client and push to the dev database.

### Files to modify

- `server/prisma/schema.prisma` — add three boolean fields to `model Group`

### Steps

1. Open `server/prisma/schema.prisma`.
2. Inside `model Group`, after the last existing field, add:
   ```prisma
   allowsOauthClient    Boolean @default(false)
   allowsLlmProxy       Boolean @default(false)
   allowsLeagueAccount  Boolean @default(false)
   ```
3. Run `npx prisma generate` to regenerate the Prisma client.
4. Run `npx prisma db push` (dev) to apply the schema to the dev database.
5. Confirm the Prisma-generated `Group` type includes the three new fields.

### Testing plan

- Run the full server test suite (`npm run test:server`) to confirm no regressions.
- No new tests needed for this ticket — the schema change is validated by the existing
  integration tests (which create Group rows) and by the Prisma client type check.

### Documentation updates

None required for this ticket.
