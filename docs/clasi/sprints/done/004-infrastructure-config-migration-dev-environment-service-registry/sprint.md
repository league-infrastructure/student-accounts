---
id: '004'
title: 'Infrastructure: Config Migration, Dev Environment, Service Registry'
status: done
branch: sprint/004-infrastructure-config-migration-dev-environment-service-registry
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
---

# Sprint 004: Infrastructure — Config Migration, Dev Environment, Service Registry

## Goals

Establish the foundational infrastructure patterns that all future sprints
depend on. Migrate secrets management from `secrets/` to the `config/`
directory structure (using `dotconfig init`), restructure Docker for local
development so the dev database lives in its own compose file, and introduce
the ServiceRegistry pattern as the composition root for the service layer.

This sprint is **local dev only**. No production Docker work.

## Problem

The template currently has three infrastructure gaps that block the planned
v2 upgrade:

1. **Config layout.** Secrets live in a flat `secrets/` directory with one
   encrypted file per environment. The inventory app proved that splitting
   public config from encrypted secrets — and organizing by environment under
   a single `config/` directory — is cleaner for onboarding, CI, and
   day-to-day development.

2. **Dev database coupling.** The dev PostgreSQL instance is bundled into
   `docker-compose.yml` alongside the app services. This makes it awkward to
   run the server and client natively while keeping only the database in
   Docker. A dedicated `docker-compose.dev.yml` for the database alone is
   simpler and mirrors the inventory app's setup.

3. **No service registry.** Routes call service functions directly with no
   central composition root. This makes dependency injection difficult,
   complicates testing, and provides no clear pattern for new contributors
   (human or AI) to follow when adding business logic.

## Solution

1. **Config migration.** Create the `config/` directory structure using
   `dotconfig init`. Split existing `secrets/dev.env` into
   `config/dev/public.env` (non-secret values) and `config/dev/secrets.env`
   (encrypted secrets). Same for prod. Move `.sops.yaml` into
   `config/sops.yaml`. Update scripts and docs. Keep the old `secrets/`
   directory intact until the stakeholder verifies the transfer.

2. **Dev compose split.** Create `docker-compose.dev.yml` containing only
   PostgreSQL (port 5433, user `app`, password `devpassword`, database
   `app`, health check, pgdata volume). Update `npm run dev` to start this
   compose file alongside the native server and client.

3. **ServiceRegistry.** Create `server/src/services/service.registry.ts`
   with a constructor that takes `PrismaClient` and an optional `source`
   string. Provide a static `create()` factory method. Refactor existing
   services (`ConfigService`, `CounterService`, `LogBufferService`) into
   the registry. Create `server/src/contracts/` for shared types. Update
   route handlers to receive the registry instead of importing services
   directly.

## Success Criteria

- `npm run dev` starts successfully with the new config layout (database
  starts via `docker-compose.dev.yml`, migrations run, server and client
  start, app is usable at `localhost:5173`)
- The `config/` directory exists with `dev/public.env`, `dev/secrets.env`,
  `prod/public.env`, `prod/secrets.env`, and `sops.yaml`
- The old `secrets/` directory is still present (not deleted until
  stakeholder verifies)
- The ServiceRegistry is in use: routes receive it and delegate to
  service methods
- All existing server tests pass (`npm run test:server`)
- No runtime errors or missing environment variable warnings

## Scope

### In Scope

- Create `config/` directory structure via `dotconfig init`
- Split `secrets/dev.env` into `config/dev/public.env` and
  `config/dev/secrets.env`
- Split `secrets/prod.env` into `config/prod/public.env` and
  `config/prod/secrets.env`
- Create `config/sops.yaml` (move or reference root `.sops.yaml`)
- Update `.gitignore` for `config/local/`
- Update `scripts/install.sh` to source from `config/`
- Create `docker-compose.dev.yml` (PostgreSQL only)
- Update npm scripts (`dev`, `dev:docker`) for the new layout
- Ensure `DATABASE_URL` flows from `config/dev/public.env`
- Create `server/src/services/service.registry.ts`
- Refactor `config.ts`, `counter.ts`, `logBuffer.ts` into registry
  services
- Create `server/src/contracts/` with shared types
- Update route handlers to use the registry
- Update docs: `docs/secrets.md`, `docs/setup.md`, `docs/template-spec.md`

### Out of Scope

- Production Docker work (deferred to final sprint)
- New services beyond wrapping existing ones (UserService, BackupService,
  etc. come in later sprints)
- Deleting the old `secrets/` directory
- Auth system changes
- Admin dashboard changes
- Client-side changes (beyond verifying the app still works)

## Test Strategy

- Run existing server test suite (`npm run test:server`) after each major
  change to catch regressions
- Manual verification: `npm run dev` starts cleanly with the new config
  layout, database connects, all existing pages load
- Verify that routes still function correctly after the ServiceRegistry
  refactor (counter API, admin endpoints, health check)

## Architecture Notes

See `architecture.md` in this sprint directory for detailed design of the
config directory structure, Docker compose split, ServiceRegistry pattern,
and contracts directory.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases,
  architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

1. **001** — Migrate secrets to config directory
2. **002** — Create docker-compose.dev.yml and update dev scripts
3. **003** — Create ServiceRegistry and contracts directory
4. **004** — Refactor existing services into ServiceRegistry
5. **005** — Verify dev workflow and update docs
