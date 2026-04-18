---
id: '004'
title: Refactor existing services into ServiceRegistry
status: todo
use-cases:
- SUC-003
- SUC-004
depends-on:
- '003'
---

# Refactor existing services into ServiceRegistry

## Description

Wrap the three existing service modules (`config.ts`, `counter.ts`,
`logBuffer.ts`) as proper service classes and register them in the
ServiceRegistry. Update route handlers to access services through
`req.services` instead of direct imports. Add middleware to attach the
registry to every request.

### Changes

1. **Refactor `server/src/services/config.ts`**:
   - Wrap existing exports as `ConfigService` class
   - Constructor accepts `PrismaClient`

2. **Refactor `server/src/services/counter.ts`**:
   - Wrap existing exports as `CounterService` class
   - Constructor accepts `PrismaClient`

3. **Refactor `server/src/services/logBuffer.ts`**:
   - Wrap existing exports as `LogBufferService` class
   - No Prisma dependency (in-memory service)

4. **Update `server/src/services/service.registry.ts`**:
   - Add `config`, `counter`, and `logBuffer` properties
   - Instantiate all three services in the constructor

5. **Create `server/src/middleware/services.ts`**:
   - Middleware that attaches the `ServiceRegistry` to `req.services`
   - Type augmentation for Express `Request` to include `services`

6. **Update `server/src/index.ts` (or `app.ts`)**:
   - Create `ServiceRegistry` at app startup
   - Register the services middleware

7. **Update route handlers**:
   - `server/src/routes/counter.ts` — use `req.services.counter`
   - `server/src/routes/admin/*` — use `req.services.config` and
     `req.services.logBuffer`
   - `server/src/routes/health.ts` — use registry if applicable

8. **Update `clearAll()`** in ServiceRegistry to truncate the correct
   tables for all registered services.

## Acceptance Criteria

- [ ] `ConfigService` class wraps existing config functionality
- [ ] `CounterService` class wraps existing counter functionality
- [ ] `LogBufferService` class wraps existing log buffer functionality
- [ ] All three services registered as properties on `ServiceRegistry`
- [ ] Middleware at `server/src/middleware/services.ts` attaches registry to `req.services`
- [ ] Express `Request` type augmented to include `services: ServiceRegistry`
- [ ] `ServiceRegistry` created at app startup and middleware registered
- [ ] Counter routes use `req.services.counter` instead of direct imports
- [ ] Admin routes use `req.services.config` and `req.services.logBuffer`
- [ ] Routes are thin handlers: validate input, call service, format response
- [ ] `clearAll()` truncates all service-managed tables
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)

## Testing

- **Existing tests to run**: `npm run test:server` — all existing tests
  must pass after the refactor
- **Verification**: Start the app with `npm run dev`, confirm counter API
  (GET, POST increment/decrement), admin dashboard, and health check all
  work correctly
- **Regression focus**: Counter API and admin endpoints are the primary
  risk areas since their service access pattern changes
