---
title: 'Channel name mismatch: server seeds ''#general'' but Chat expects ''general'''
priority: medium
status: done
sprint: '010'
tickets:
- '006'
---

## Problem

`server/src/index.ts` line 27-31 seeds a channel named `#general`
(with hash prefix):
```typescript
await prisma.channel.upsert({
  where: { name: '#general' },
  ...
  create: { name: '#general', description: 'General discussion' },
});
```

But `client/src/pages/Chat.tsx` looks for a channel named `general`
(no hash prefix):
```typescript
const general = data.find((c) => c.name === 'general');
```

And `server/prisma/seed.ts` also creates `general` (no hash).

This means the auto-select won't find the server-seeded channel.

## Expected Behavior

Pick one convention and use it consistently. The hash prefix is
redundant since the UI already prepends `#` when displaying channel
names.

## Files

- `server/src/index.ts` — seeds `#general`
- `server/prisma/seed.ts` — seeds `general`
- `client/src/pages/Chat.tsx` — looks for `general`
