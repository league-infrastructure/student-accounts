---
status: draft
---

# Sprint 004 Use Cases

## SUC-001: Developer sets up config directory and decrypts secrets
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: Repository cloned, SOPS + age installed, age key available
- **Main Flow**:
  1. Developer runs `dotconfig init` (or the manual setup steps)
  2. The `config/` directory is created with `dev/`, `prod/`, and `local/`
     subdirectories
  3. `config/dev/public.env` contains non-secret environment variables
     (APP_DOMAIN, DATABASE_URL, DEPLOYMENT, callback URLs)
  4. `config/dev/secrets.env` contains SOPS-encrypted secrets (passwords,
     tokens, API keys)
  5. `config/sops.yaml` defines the encryption policy
  6. Developer decrypts secrets for local use (e.g., `sops -d
     config/dev/secrets.env >> .env`)
  7. The decrypted `.env` file contains all values needed to run the app
- **Postconditions**: Config directory exists with split public/secret
  files; developer has a working `.env` for local development
- **Acceptance Criteria**:
  - [ ] `config/dev/public.env` exists with non-secret values
  - [ ] `config/dev/secrets.env` exists and is SOPS-encrypted
  - [ ] `config/prod/public.env` and `config/prod/secrets.env` exist
  - [ ] `config/sops.yaml` defines encryption keys and path rules
  - [ ] `config/local/` is gitignored for developer-specific overrides
  - [ ] Old `secrets/` directory is still intact (not deleted)
  - [ ] Decrypting and combining config files produces a valid `.env`

## SUC-002: Developer runs local dev environment with new compose layout
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: Config directory set up (SUC-001), Docker running,
  `.env` configured
- **Main Flow**:
  1. Developer runs `npm run dev`
  2. `docker-compose.dev.yml` starts PostgreSQL on port 5433
  3. Prisma runs migrations against the dev database
  4. Express server starts with tsx hot-reload on port 3000
  5. Vite dev server starts on port 5173
  6. All API endpoints respond correctly
  7. Frontend proxies API requests to the backend
- **Postconditions**: Full dev stack running with database in Docker,
  server and client running natively
- **Acceptance Criteria**:
  - [ ] `docker-compose.dev.yml` contains only PostgreSQL (no app services)
  - [ ] `npm run dev` starts DB container, server, and client concurrently
  - [ ] Database health check passes before server starts
  - [ ] Prisma migrations apply on startup
  - [ ] Counter API works (GET, POST increment/decrement)
  - [ ] Admin dashboard loads
  - [ ] Vite proxies `/api` requests to Express

## SUC-003: Developer adds a new service to the ServiceRegistry
Parent: N/A (infrastructure)

- **Actor**: Developer (human or AI agent)
- **Preconditions**: ServiceRegistry exists, app is running
- **Main Flow**:
  1. Developer creates a new service class in `server/src/services/`
  2. The service constructor accepts `PrismaClient` (and optionally
     `source`)
  3. Developer registers the service as a property in
     `service.registry.ts`
  4. Developer creates or updates route handlers to access the service
     via the registry
  5. The route handler is a thin adapter: validates input, calls the
     service method, formats the response
- **Postconditions**: New service is available through the registry;
  routes delegate to it
- **Acceptance Criteria**:
  - [ ] `ServiceRegistry` class exists at
    `server/src/services/service.registry.ts`
  - [ ] Constructor accepts `PrismaClient` and optional `source` parameter
  - [ ] Static `create()` factory method initializes the registry
  - [ ] Existing services (ConfigService, CounterService, LogBufferService)
    are registered
  - [ ] `clearAll()` method exists for test cleanup
  - [ ] Route handlers receive the registry (not raw service imports)
  - [ ] `server/src/contracts/` directory exists with shared type
    definitions

## SUC-004: Existing tests pass with refactored service layer
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: ServiceRegistry refactor complete, config migration
  done
- **Main Flow**:
  1. Developer runs `npm run test:server`
  2. All existing server tests execute
  3. All tests pass without modification (or with minimal test setup
     updates to use the registry)
- **Postconditions**: Test suite green, no regressions from
  infrastructure changes
- **Acceptance Criteria**:
  - [ ] `npm run test:server` passes with zero failures
  - [ ] No new warnings related to config loading or service initialization
  - [ ] Tests that hit the counter API still work through the registry
  - [ ] Tests that hit admin endpoints still work through the registry
