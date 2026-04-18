---
status: draft
from-architecture-version: null
to-architecture-version: null
---

# Sprint 003 Technical Plan

## Architecture Version

- **From version**: no change (infrastructure upgrade)
- **To version**: no change

## Architecture Overview

This is a dependency upgrade sprint. The component architecture stays
the same — Express backend, React frontend, PostgreSQL database. The
changes are to the Prisma layer and the server's module system.

```
Before:
  server (CJS) → @prisma/client (6.x, generated in node_modules)

After:
  server (ESM) → generated prisma client (7.x, server/src/generated/prisma/)
               → @prisma/adapter-pg → pg Pool → PostgreSQL
```

## Decisions

1. **ESM module resolution**: Use `"moduleResolution": "bundler"`.
   Allows extensionless imports — no need to add `.js` to every relative
   import (~25 files). Pragmatic for an Express app.

2. **Prisma client output**: Generate to `server/src/generated/prisma/`.
   Prisma's recommended convention. Gets compiled by tsc, gitignored.

## Component Design

### Component: Prisma Schema & Config

**Use Cases**: SUC-001, SUC-002, SUC-003

Update `server/prisma/schema.prisma`:
- Change generator provider from `prisma-client-js` to `prisma-client`
- Add `output` field pointing to `../src/generated/prisma`

Create `server/prisma.config.ts`:
- Import `dotenv/config` to load `.env` for CLI operations (Prisma 7
  no longer auto-loads env vars)
- Configure schema path and migration output

Add `server/src/generated/` to `.gitignore`.

### Component: Prisma Client Singleton

**Use Cases**: SUC-001, SUC-002, SUC-003

Update `server/src/services/prisma.ts`:
- Import PrismaClient from `../generated/prisma` (new output path)
- Import `@prisma/adapter-pg` and `pg`
- Create a `pg.Pool` with the DATABASE_URL
- Set `connectionTimeoutMillis` on the pool (e.g., 5000ms) to match
  Prisma 6's built-in pool behavior
- Pass the adapter to PrismaClient constructor
- Use lazy initialization pattern to avoid crashing tests that import
  the app without DATABASE_URL set

### Component: Server ESM Migration

**Use Cases**: SUC-001, SUC-002, SUC-003

Update `server/package.json`:
- Add `"type": "module"`
- Replace `ts-node-dev` with `tsx` in dev script

Update `server/tsconfig.json`:
- Change `"module": "commonjs"` → `"module": "ESNext"`
- Add `"moduleResolution": "bundler"`

Fix CJS calls in source:
- `server/src/app.ts` line ~90: replace `require('path')` with an
  ESM `import path from 'path'` at top of file

### Component: Docker Build Updates

**Use Cases**: SUC-002

Update `docker/Dockerfile.server`:
- Ensure generated client directory (`src/generated/prisma/`) is
  included in the tsc compile and copied to the runtime stage
- The `COPY --from=server-builder /app/prisma ./prisma` line is still
  needed for migrations

Update `docker/Dockerfile.server.dev`:
- Replace `ts-node-dev` invocation with `tsx watch`
- Ensure `npx prisma generate` runs correctly

Update `docker/dev-server-start.sh`:
- **Remove `--skip-generate` flag** from `prisma migrate dev` command
  (flag removed in Prisma 7)
- Replace `ts-node-dev` startup command with `tsx watch`

### Component: Root Script Updates

**Use Cases**: SUC-001

Update `package.json` (root):
- `dev:local:server` script: verify Prisma CLI commands work (likely
  unchanged — `npx prisma generate` and `npx prisma migrate dev`)
- `dev:docker:migrate` script: verify compatibility

### Component: Test Infrastructure

**Use Cases**: SUC-003

The test suite uses `ts-jest` with configs that extend the server's
tsconfig. When the server moves to ESM, the test infrastructure needs
verification:

- `tests/server/jest.config.js` — CJS config file (`module.exports`).
  Jest loads this with its own module system, should work as-is.
- `tests/server/tsconfig.json` — Extends `../../server/tsconfig.json`.
  When the server tsconfig changes to `"module": "ESNext"`, `ts-jest`
  may need explicit overrides to keep working. May need to override
  `module` back to `commonjs` in the test tsconfig, or configure
  `ts-jest` for ESM mode.
- Verify all existing tests pass after the migration.
