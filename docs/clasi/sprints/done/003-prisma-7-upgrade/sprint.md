---
id: '003'
title: Prisma 7 Upgrade
status: done
branch: sprint/003-prisma-7-upgrade
use-cases:
- SUC-001
- SUC-002
- SUC-003
---

# Sprint 003: Prisma 7 Upgrade

## Goals

Upgrade Prisma from v6 to v7 across the entire stack — schema, client
instantiation, Docker builds, dev scripts, and CI — without breaking
existing functionality.

## Problem

Prisma 6.x is approaching end-of-life. The dev server shows a nag
prompting upgrade to 7.4.2. Prisma 7 is a major version with breaking
changes (new generator, ESM-first output, mandatory driver adapters,
new config file). Staying on 6.x means missing performance improvements,
security patches, and eventually losing community support.

## Solution

Perform a structured migration following Prisma's official upgrade guide:

1. Update the Prisma schema generator from `prisma-client-js` to
   `prisma-client` with an explicit `output` field.
2. Install and configure the `@prisma/adapter-pg` driver adapter.
3. Create `prisma.config.ts` for centralized Prisma configuration.
4. Migrate the server to ESM (`"type": "module"` in package.json,
   updated tsconfig).
5. Replace `ts-node-dev` with `tsx` for dev hot-reload (ts-node-dev
   has known ESM issues).
6. Update all Docker files and scripts that invoke Prisma CLI.
7. Update the Prisma client singleton to use the new driver adapter.
8. Verify all existing functionality works.

## Success Criteria

- `npm run dev` starts successfully with Prisma 7
- `npm run dev:docker` starts successfully with Prisma 7
- All existing server tests pass (`npm run test:server`)
- Database migrations apply cleanly (`prisma migrate dev`)
- Admin dashboard DB viewer, config panel, and session viewer all work
- Counter API works (increment/decrement)
- No runtime warnings about deprecated Prisma features

## Scope

### In Scope

- Prisma package upgrade (prisma, @prisma/client → 7.x)
- New `@prisma/adapter-pg` driver adapter
- Schema generator migration (`prisma-client-js` → `prisma-client`)
- `prisma.config.ts` creation
- Server ESM migration (package.json type, tsconfig module)
- Replace `ts-node-dev` with `tsx` for dev server
- Update Docker build files (Dockerfile.server, Dockerfile.server.dev)
- Update `dev-server-start.sh` and `wait-for-db.sh`
- Update root package.json scripts referencing Prisma
- Update Prisma client singleton (`server/src/services/prisma.ts`)
- Verify all imports work with ESM resolution

### Out of Scope

- Client (frontend) changes — no Prisma usage in client
- Database schema changes — models stay identical
- New Prisma features (e.g., typed SQL, Prisma Pulse)
- Prisma Studio workflow changes
- Production deployment — verified locally and in Docker dev only

## Test Strategy

- Run existing server test suite (`npm run test:server`) after each
  major change to catch regressions
- Manual verification of all admin dashboard database operations
- Docker dev environment full startup test
- Native dev environment full startup test

## Architecture Notes

**Key change:** Prisma 7 no longer generates the client into
`node_modules/.prisma/client`. Instead, the generator requires an
explicit `output` path. The standard convention is to generate into
a project-local directory (e.g., `server/src/generated/prisma/`).

**ESM migration:** The server currently uses CommonJS (`"module":
"commonjs"` in tsconfig). Prisma 7's generated client is ESM-first.
The cleanest path is to migrate the server to ESM, which also means
replacing `ts-node-dev` (poor ESM support) with `tsx` (native ESM).

**Driver adapter:** Prisma 7 requires explicit database driver adapters.
For PostgreSQL, this means installing `@prisma/adapter-pg` and passing
it to the PrismaClient constructor alongside the `pg` Pool.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, technical plan)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

1. **001** — Server ESM migration and tsx replacement
2. **002** — Prisma 7 schema, config, and client upgrade (depends on 001)
3. **003** — Docker and script updates for Prisma 7 and ESM (depends on 001, 002)
4. **004** — Test infrastructure ESM compatibility (depends on 001, 002)
