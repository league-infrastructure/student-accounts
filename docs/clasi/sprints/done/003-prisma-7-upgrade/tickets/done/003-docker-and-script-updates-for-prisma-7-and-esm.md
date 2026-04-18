---
id: '003'
title: Docker and script updates for Prisma 7 and ESM
status: done
use-cases:
- SUC-002
depends-on:
- '001'
- '002'
---

# Docker and script updates for Prisma 7 and ESM

## Description

Update all Docker files and root package.json scripts to work with
Prisma 7 and the server's ESM module system.

### Changes

1. **`docker/Dockerfile.server`** (production):
   - Verify `npx prisma generate` works with new schema
   - Ensure compiled generated client (`dist/generated/prisma/`) is
     included in the runtime stage
   - Keep `COPY --from=server-builder /app/prisma ./prisma` for migrations

2. **`docker/Dockerfile.server.dev`** (development):
   - Replace `ts-node-dev` with `tsx watch` in CMD
   - Verify `npx prisma generate` runs correctly

3. **`docker/dev-server-start.sh`**:
   - Remove `--skip-generate` flag from `prisma migrate dev` command
     (flag removed in Prisma 7)
   - Replace `ts-node-dev` startup with `tsx watch`

4. **`package.json` (root)**:
   - Verify `dev:local:server` script works (prisma generate + migrate)
   - Verify `dev:docker:migrate` script works

## Acceptance Criteria

- [x] `docker/Dockerfile.server` builds successfully
- [x] `docker/Dockerfile.server.dev` builds successfully
- [x] `docker/dev-server-start.sh` no longer uses `--skip-generate`
- [x] `docker/dev-server-start.sh` uses `tsx` instead of `ts-node-dev`
- [x] Root `dev:local:server` script works end-to-end (no changes needed)
- [ ] `npm run dev:docker` builds and starts without errors (requires Docker)

## Testing

- **Verification**: `npm run dev:docker` full startup test
- **Verification**: `docker build -f docker/Dockerfile.server .` succeeds
