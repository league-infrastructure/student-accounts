---
id: '007'
title: Remove Counter demo
status: done
use-cases:
- SUC-002
depends-on: []
---

# Remove Counter demo

## Description

Remove the Counter demo feature entirely: Prisma model, service, API
routes, and client code. Create a Prisma migration to drop the Counter
table. This is a clean break since this is a template with no production
data.

### Changes

1. **`server/prisma/schema.prisma`**: Remove the `Counter` model

2. **Prisma migration**: Create migration to drop the `Counter` table
   (`npx prisma migrate dev --name drop-counter`)

3. **`server/src/services/counter.ts`** (or similar): Delete the
   CounterService file

4. **`server/src/routes/counter.ts`** (or similar): Delete the counter
   routes file

5. **`server/src/app.ts`**: Remove counter route import and mount

6. **`server/src/services/service.registry.ts`**: Remove CounterService
   registration if present

7. **Client code**: Remove any counter-related components, pages, or
   API call functions from `client/src/`

## Acceptance Criteria

- [x] `Counter` model removed from Prisma schema
- [x] Prisma migration drops the `Counter` table
- [x] CounterService file deleted
- [x] Counter routes file deleted
- [x] Counter routes unmounted from `app.ts`
- [x] CounterService removed from ServiceRegistry
- [x] All counter-related client code removed
- [x] `npx prisma migrate dev` completes without errors
- [x] No references to "counter" remain in source code (excluding
      git history and migration files)
- [x] Existing tests pass: `npm run test:server`

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
- **New tests to write**: None (removal only)
- **Verification command**: `npm run test:server && npm run test:client`
