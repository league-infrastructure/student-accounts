---
id: 009
title: Production Deployment & Polish
status: done
branch: sprint/009-production-deployment-polish
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
---

# Sprint 009: Production Deployment & Polish

## Goals

Take the fully-working local development application and make it
deployable to production via Docker Swarm. Clean up unused files, run the
full test suite, verify end-to-end, and ensure the template is ready for
new projects to fork from.

This is the **final sprint**. All previous sprints (004-008) ran and were
verified on local dev only. This sprint bridges the gap to production.

## Problem

The application works locally via `npm run dev` but has no production
deployment path. The existing `docker-compose.prod.yml` and
`docker/Dockerfile.server` are stale — they predate the config migration,
service registry, chat application, MCP server, and auth system added in
sprints 004-008. The Docker directory contains unused files (the Caddy
static client variant), and the old `secrets/` directory still exists
alongside the newer `config/` structure.

## Solution

1. Create a production `docker-compose.yml` Swarm stack with a single
   server service (Express serves API + built Vite client), PostgreSQL,
   Swarm secrets, and Caddy reverse proxy labels.
2. Rebuild `docker/Dockerfile.server` as a multi-stage production image
   that compiles server TypeScript and builds the Vite client in one image.
3. Update `docker/entrypoint.sh` for the new secrets mount pattern
   (named secrets like `database_url`, `session_secret`,
   `mcp_default_token`).
4. Remove `Dockerfile.client` / `Dockerfile.client.dev` (Caddy static
   variant) — client is served by Express in production.
5. Set up `config/prod/` with production environment values.
6. Add a `build:docker` npm script.
7. Update `docs/deployment.md` with the new production workflow.
8. Remove the old `secrets/` directory (after stakeholder verification).
9. Run the full test suite and fix any breakage.
10. Production smoke tests: image builds, starts, serves app, loads
    secrets, Swarm deployment, database and integration smoke.

## Success Criteria

- `npm run build:docker` succeeds and produces a working production image
- Production image starts and serves both the API and the Vite-built
  client from a single container
- `docker stack deploy` succeeds on a Swarm node
- Swarm secrets load correctly as environment variables via
  `entrypoint.sh`
- Prisma migrations run against the production database
- Application is accessible through the Caddy reverse proxy
- Full test suite (`test:server`, `test:client`) passes on a clean
  checkout
- No stale Docker files, unused compose files, or orphaned secrets
  directory remain
- `docs/deployment.md` documents the complete production workflow

## Scope

### In Scope

- `docker-compose.yml` — Production Swarm stack (single server service
  serving API + built client, PostgreSQL, Swarm secrets, Caddy labels)
- `docker/Dockerfile.server` — Multi-stage production build (compile
  server TS + build client Vite assets, slim runtime image)
- `docker/entrypoint.sh` — Updated for new secrets mount pattern
  (`database_url`, `session_secret`, `mcp_default_token`, etc.)
- Remove `Dockerfile.client` and `Dockerfile.client.dev` (Caddy static
  variant) — client served by Express in prod
- `config/prod/` setup with production values (`public.env`,
  `secrets.env`)
- `build:docker` npm script in root `package.json`
- Update `docs/deployment.md` with production workflow
- Clean up unused Docker files and stale compose files
- Remove old `secrets/` directory (after stakeholder verification that
  values have been transferred to `config/`)
- Run full test suite, fix any breakage
- Production smoke tests: image builds, starts, serves app, loads secrets
- Swarm deployment verification
- Database migration and integration smoke tests

### Out of Scope

- New application features — the app is feature-complete from sprints
  004-008
- CI/CD pipeline setup (GitHub Actions, etc.)
- Multi-node Swarm configuration or load balancing
- SSL certificate management (handled by Caddy automatically)
- Monitoring, alerting, or log aggregation infrastructure
- Performance tuning or caching

## Dependencies

- Sprint 004 (Infrastructure, Config, Service Registry)
- Sprint 005 (Auth & User Management)
- Sprint 006 (Admin Dashboard)
- Sprint 007 (UI Shell & Chat Application)
- Sprint 008 (MCP Server & Documentation)

All must be merged to `master` before this sprint begins.

## Test Strategy

### Automated Tests

Run the full existing test suite to confirm nothing is broken:

- `npm run test:server` — all backend API, auth, chat, MCP, admin, and
  service layer tests
- `npm run test:client` — all frontend component and integration tests

Fix any failures before proceeding to production Docker work.

### Production Smoke Tests

Manual or scripted verification of the production deployment path:

1. **Image build** — `npm run build:docker` completes without errors
2. **Image start** — Container starts, Express binds to port 3000,
   serves both `/api/health` and the client SPA
3. **Secrets loading** — Mount test secret files at `/run/secrets/`,
   verify `entrypoint.sh` exports them as environment variables
4. **Swarm deploy** — `docker stack deploy` creates the stack, services
   come up healthy
5. **Database** — Prisma migrations run against the production database,
   app connects and serves data
6. **Caddy integration** — App is accessible via the configured domain
   through the Caddy reverse proxy
7. **End-to-end** — Can log in, view the chat, access admin panel, and
   call MCP endpoint on the deployed instance

## Architecture Notes

The production architecture consolidates the application into a single
server container. Express serves both the API (under `/api`) and the
Vite-built static client assets (SPA fallback for all other routes).
This eliminates the need for a separate Caddy-based client container.

The multi-stage Dockerfile compiles server TypeScript and builds the
Vite client in build stages, then copies only the compiled output into a
slim Node.js Alpine runtime image.

Swarm secrets are mounted as files at `/run/secrets/<name>`. The
`entrypoint.sh` script reads each file and exports the contents as
uppercased environment variables before starting the Node.js process.

See `architecture.md` for full details.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

1. **001** — Create production Dockerfile
2. **002** — Create production Docker Compose and Caddy config
3. **003** — Clean up unused files and update deployment docs
4. **004** — Run full test suite and production smoke tests
