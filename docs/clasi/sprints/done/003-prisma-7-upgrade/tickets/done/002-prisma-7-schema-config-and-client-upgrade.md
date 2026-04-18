---
id: '002'
title: Prisma 7 schema, config, and client upgrade
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '001'
---

# Prisma 7 schema, config, and client upgrade

## Description

Upgrade Prisma packages to v7, update the schema generator, create the
new config file, install the driver adapter, and rewire the client
singleton.

### Changes

1. **Package upgrades** (`server/package.json`):
   - `prisma` → `^7.0.0` (devDependencies)
   - `@prisma/client` → remove (replaced by generated output)
   - Add `@prisma/adapter-pg` to dependencies

2. **`server/prisma/schema.prisma`**:
   - Change `provider = "prisma-client-js"` → `provider = "prisma-client"`
   - Add `output = "../src/generated/prisma"`

3. **Create `server/prisma.config.ts`**:
   - Import `dotenv/config` for env loading
   - Configure schema path

4. **`server/src/services/prisma.ts`**:
   - Import `PrismaClient` from `../generated/prisma`
   - Import `PrismaPg` from `@prisma/adapter-pg`
   - Create `pg.Pool` with DATABASE_URL and `connectionTimeoutMillis: 5000`
   - Pass adapter to PrismaClient constructor
   - Use lazy initialization to avoid crashing tests without DATABASE_URL

5. **Update all imports of Prisma types**: Any file that imports types
   from `@prisma/client` must change to import from the generated path.

6. **`.gitignore`**: Add `server/src/generated/`

7. **Run `npx prisma generate`** and verify output location.

## Acceptance Criteria

- [x] `prisma` and `@prisma/adapter-pg` at v7.x in package.json
- [x] Schema uses `prisma-client` generator with output field
- [x] `prisma.config.ts` exists and loads env vars
- [x] Client singleton uses driver adapter with PrismaPg
- [x] `npx prisma generate` produces output in `server/src/generated/prisma/`
- [x] `server/src/generated/` is gitignored
- [ ] `npx prisma migrate dev` runs successfully (requires running DB)
- [ ] Server starts and can query the database (requires running DB)

## Testing

- **Existing tests to run**: `npm run test:server`
- **Verification**: Start dev server, hit health endpoint, test counter API
