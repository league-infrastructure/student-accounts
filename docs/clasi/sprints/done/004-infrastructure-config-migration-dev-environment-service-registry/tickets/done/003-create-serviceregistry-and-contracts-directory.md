---
id: '003'
title: Create ServiceRegistry and contracts directory
status: todo
use-cases:
- SUC-003
depends-on: []
---

# Create ServiceRegistry and contracts directory

## Description

Introduce the ServiceRegistry class as the composition root for the service
layer, and create the contracts directory for shared TypeScript type
definitions. This ticket creates the infrastructure; the next ticket (004)
wires existing services into it.

### Changes

1. **Create `server/src/contracts/service.ts`**:
   - Export `ServiceSource` type: `'UI' | 'API' | 'MCP' | 'SYSTEM'`

2. **Create `server/src/contracts/index.ts`**:
   - Re-export all types from `service.ts`

3. **Create `server/src/services/service.registry.ts`**:
   - `ServiceRegistry` class with:
     - Constructor accepting `PrismaClient` and optional `source: ServiceSource`
       (default `'API'`)
     - Static `async create(source?: ServiceSource)` factory method that
       imports and initializes PrismaClient, then returns a new registry
     - `async clearAll()` method that truncates service-managed tables
       (for test cleanup)
   - Service properties will be added in ticket 004 when existing services
     are refactored

4. **Verify TypeScript compilation**: `cd server && npx tsc --noEmit`

## Acceptance Criteria

- [ ] `server/src/contracts/service.ts` exists with `ServiceSource` type
- [ ] `server/src/contracts/index.ts` re-exports all contract types
- [ ] `server/src/services/service.registry.ts` exists with `ServiceRegistry` class
- [ ] Constructor accepts `PrismaClient` and optional `source` parameter
- [ ] Static `create()` factory method initializes Prisma and returns a registry
- [ ] `clearAll()` method exists for test cleanup
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)

## Testing

- **Existing tests to run**: `npm run test:server` to confirm no regressions
  from new files
- **Verification**: `cd server && npx tsc --noEmit` to verify compilation
- **New tests to write**: Basic instantiation test for ServiceRegistry can
  be deferred to ticket 004 when services are wired in
