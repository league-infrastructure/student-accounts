---
id: '004'
title: Fix page title, search bar, and add seed data
status: done
use-cases: []
depends-on: []
---

# Fix page title, search bar, and add seed data

## Description

Three small fixes:
1. `client/index.html` has `<title>client-tmp</title>` — change to
   "College App Navigator".
2. The search bar in AppLayout accepts text but does nothing. Remove it
   since search is not a v1 feature.
3. No seed data exists — add a Prisma seed script that creates a default
   "general" channel so chat works on fresh installs.

## Acceptance Criteria

- [ ] Browser tab title says "College App Navigator"
- [ ] Search bar is removed from the topbar
- [ ] Prisma seed script creates a "general" channel
- [ ] `npm run dev` with fresh DB has a working channel in chat

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
- **New tests to write**: None required for these changes
- **Verification command**: `npm run test:server && npm run test:client`
