---
id: '006'
title: "Fix channel name mismatch \u2014 #general vs general"
status: done
use-cases: []
depends-on: []
---

# Fix channel name mismatch — #general vs general

## Description

`server/src/index.ts` seeds a channel named `#general` (with hash prefix),
but `client/src/pages/Chat.tsx` looks for `general` (no prefix) and
`server/prisma/seed.ts` also creates `general`. The UI already prepends `#`
when displaying channel names, so the hash in the DB name is redundant.

Fix by changing the index.ts seed to use `general` (no hash prefix) to match
the client and seed script.

## Acceptance Criteria

- [x] index.ts seeds channel named `general` (not `#general`)
- [x] Chat page auto-selects the general channel on load
- [x] Seed script and index.ts use the same channel name

## Testing

- **Existing tests to run**: `npm run test:server`
- **Verification command**: `npm run test:server`
