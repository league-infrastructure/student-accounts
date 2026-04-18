---
status: approved
---

# Sprint 009 Use Cases

## SUC-001: Ops deploys the application to Docker Swarm
Parent: N/A (infrastructure)

- **Actor**: Operations engineer (or developer acting as ops)
- **Preconditions**: Docker Swarm initialized on target node, production
  secrets created in Swarm (`docker secret create`), production database
  accessible, Caddy reverse proxy running on the Swarm overlay network
- **Main Flow**:
  1. Ops runs `npm run build:docker` to build the production image
  2. Ops tags and pushes the image to the container registry
  3. Ops creates or updates Swarm secrets from `config/prod/secrets.env`
  4. Ops runs `docker stack deploy -c docker-compose.yml <stackname>`
  5. Swarm starts the server and database services
  6. The server container's entrypoint loads secrets from `/run/secrets/*`
     as environment variables
  7. Prisma migrations run against the production database
  8. Caddy picks up the service labels and routes traffic to the app
  9. Application is accessible at `https://<app>.jtlapp.net`
- **Postconditions**: Application running in production, accessible via
  HTTPS, all services healthy
- **Acceptance Criteria**:
  - [ ] `docker stack deploy` completes without errors
  - [ ] `docker service ls` shows all services as running/replicated
  - [ ] Application responds at the configured domain
  - [ ] API endpoints return data (`/api/health`, `/api/auth/me`)
  - [ ] Client SPA loads and renders in the browser
  - [ ] Rolling update works: deploying a new tag replaces containers
        without downtime

## SUC-002: Production image builds and starts correctly
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: Repository checked out, Docker installed
- **Main Flow**:
  1. Developer runs `npm run build:docker`
  2. Multi-stage Dockerfile compiles server TypeScript
  3. Multi-stage Dockerfile builds Vite client assets
  4. Final image contains only compiled server code, built client assets,
     and production node_modules
  5. Developer starts the image with required environment variables
  6. Express binds to port 3000
  7. Express serves `/api/*` routes and the client SPA for all other paths
- **Postconditions**: Single container serving both API and client
- **Acceptance Criteria**:
  - [ ] `npm run build:docker` completes without errors
  - [ ] Image size is under 500 MB (Alpine-based, no dev dependencies)
  - [ ] `GET /api/health` returns 200
  - [ ] `GET /` returns the Vite-built `index.html`
  - [ ] Static assets (JS, CSS) are served with correct content types
  - [ ] SPA fallback works: `GET /chat` returns `index.html` (not 404)

## SUC-003: Swarm secrets load as environment variables
Parent: N/A (infrastructure)

- **Actor**: Server container (automated)
- **Preconditions**: Container started in Docker Swarm with secrets
  mounted at `/run/secrets/`
- **Main Flow**:
  1. Container starts and runs `docker/entrypoint.sh`
  2. Entrypoint iterates over files in `/run/secrets/`
  3. For each file, entrypoint reads the contents and exports as an
     uppercased environment variable (e.g., `/run/secrets/database_url`
     becomes `DATABASE_URL`)
  4. Entrypoint executes the main Node.js process with the enriched
     environment
  5. Server connects to the database using `DATABASE_URL` from secrets
  6. Server uses `SESSION_SECRET` for session signing
  7. MCP endpoint validates tokens against `MCP_DEFAULT_TOKEN`
- **Postconditions**: All secrets available as environment variables,
  application fully functional
- **Acceptance Criteria**:
  - [ ] `entrypoint.sh` reads all files in `/run/secrets/` without errors
  - [ ] Secret file names are correctly uppercased (`database_url` ->
        `DATABASE_URL`)
  - [ ] Secrets with special characters (URLs, base64 tokens) are
        preserved correctly
  - [ ] Server connects to the database using the secret-provided
        `DATABASE_URL`
  - [ ] Missing required secrets cause the server to log a clear error
        and exit non-zero

## SUC-004: Full test suite passes on clean checkout
Parent: N/A (infrastructure)

- **Actor**: Developer
- **Preconditions**: Repository checked out, dependencies installed,
  dev database running
- **Main Flow**:
  1. Developer runs `npm run test:server`
  2. All server tests pass (auth, admin, chat, MCP, service layer)
  3. Developer runs `npm run test:client`
  4. All client tests pass (components, pages, integration)
  5. Developer verifies no skipped or pending tests without justification
- **Postconditions**: Full test suite green, application verified
  functional
- **Acceptance Criteria**:
  - [ ] `npm run test:server` exits with code 0
  - [ ] `npm run test:client` exits with code 0
  - [ ] No tests are skipped without a documented reason
  - [ ] Test coverage has not regressed from pre-sprint baseline
  - [ ] Tests run in under 2 minutes total
