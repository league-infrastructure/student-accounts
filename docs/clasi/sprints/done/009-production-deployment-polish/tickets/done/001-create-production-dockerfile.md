---
id: '001'
title: Create production Dockerfile
status: done
use-cases:
- SUC-002
- SUC-003
depends-on: []
---

# Create production Dockerfile

## Description

Create (or rewrite) `docker/Dockerfile.server` as a multi-stage production
build that compiles the server TypeScript, builds the Vite client, and
produces a slim Alpine runtime image. Update `docker/entrypoint.sh` to read
Swarm secrets from `/run/secrets/*` and export them as uppercased environment
variables.

The existing `Dockerfile.server` is stale and predates the config migration,
service registry, chat application, MCP server, and auth system added in
sprints 004-008. It needs a complete rewrite.

### Changes

1. **`docker/Dockerfile.server`** — Rewrite as a three-stage build:
   - **`deps` stage**: `node:20-alpine`, install all dependencies (dev + prod)
     for both `server/` and `client/`. This stage is cached across builds.
   - **`build` stage**: Copy server and client source. Run `npx prisma generate`,
     `npx tsc` (server), and `npm run build` (client Vite build).
   - **`runtime` stage**: `node:20-alpine` slim image. Copy only compiled
     server JS (`server/dist`), built client assets (`client/dist`), production
     `node_modules`, Prisma schema and migrations (`server/prisma/`), and
     `docker/entrypoint.sh`. Expose port 3000.

2. **`docker/entrypoint.sh`** — Update for the named Swarm secrets pattern:
   - Iterate over files in `/run/secrets/*`
   - For each file, read contents and export as an uppercased env var
     (e.g., `/run/secrets/database_url` becomes `DATABASE_URL`)
   - Exec into the main command (`node server/dist/index.js`)
   - Handle edge cases: skip non-files, preserve special characters in values

3. **Verify paths**: Confirm the actual `tsc` output directory and Vite build
   output directory match what the Dockerfile copies. Adjust as needed based
   on `server/tsconfig.json` `outDir` and `client/vite.config.ts` `build.outDir`.

## Acceptance Criteria

- [ ] `docker/Dockerfile.server` is a multi-stage build with deps, build, and runtime stages
- [ ] `deps` stage installs dependencies for both server and client
- [ ] `build` stage compiles server TS (`tsc`), generates Prisma client, and builds Vite client
- [ ] `runtime` stage contains only compiled output, production node_modules, and Prisma files
- [ ] Runtime image is based on `node:20-alpine` (no dev tools or source code)
- [ ] `docker/entrypoint.sh` reads all files in `/run/secrets/` and exports as uppercased env vars
- [ ] Secrets with special characters (URLs with `://`, base64 tokens) are preserved correctly
- [ ] `ENTRYPOINT` is set to the entrypoint script, `CMD` runs the Node.js server
- [ ] Image builds successfully with `docker build -f docker/Dockerfile.server .`
- [ ] Built image size is under 500 MB

## Testing

- **Existing tests to run**: `npm run test:server` (verify server still compiles and tests pass before Dockerizing)
- **New tests to write**: None (Docker build is verified manually or in ticket 004)
- **Verification commands**:
  - `docker build -f docker/Dockerfile.server -t collegenav-server:test .`
  - `docker run --rm -e DATABASE_URL=... -p 3000:3000 collegenav-server:test`
  - Verify `GET http://localhost:3000/api/health` returns 200
  - Verify `GET http://localhost:3000/` returns the Vite-built index.html
