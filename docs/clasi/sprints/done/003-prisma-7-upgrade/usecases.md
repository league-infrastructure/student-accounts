---
status: draft
---

# Sprint 003 Use Cases

## SUC-001: Developer runs native dev environment with Prisma 7
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: Repository cloned, `.env` configured, Docker running (for DB)
- **Main Flow**:
  1. Developer runs `npm run dev`
  2. Database container starts
  3. Prisma 7 generates the client
  4. Prisma 7 runs migrations
  5. Express server starts with tsx hot-reload
  6. Vite dev server starts
  7. All API endpoints respond correctly
- **Postconditions**: Full dev stack running with Prisma 7, no deprecation warnings
- **Acceptance Criteria**:
  - [ ] `npm run dev` completes startup without errors
  - [ ] Counter API works (GET, POST increment/decrement)
  - [ ] Admin dashboard loads and shows database tables
  - [ ] No Prisma deprecation warnings in console

## SUC-002: Developer runs Docker dev environment with Prisma 7
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: Repository cloned, `.env` configured, Docker running
- **Main Flow**:
  1. Developer runs `npm run dev:docker`
  2. Docker builds server image with Prisma 7
  3. Entrypoint script runs migrations
  4. All services start and connect
- **Postconditions**: Dockerized dev stack running with Prisma 7
- **Acceptance Criteria**:
  - [ ] `npm run dev:docker` builds and starts without errors
  - [ ] Server health endpoint responds
  - [ ] Database migrations apply on container start

## SUC-003: Existing tests pass after upgrade
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: Prisma 7 upgrade applied
- **Main Flow**:
  1. Developer runs `npm run test:server`
  2. All existing tests execute
  3. All tests pass
- **Postconditions**: Test suite green
- **Acceptance Criteria**:
  - [ ] `npm run test:server` passes with zero failures
  - [ ] No new test warnings related to ESM or Prisma
