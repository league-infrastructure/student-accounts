---
id: '005'
title: Verify dev workflow and update docs
status: todo
use-cases:
- SUC-002
- SUC-004
depends-on:
- '001'
- '002'
- '004'
---

# Verify dev workflow and update docs

## Description

End-to-end verification that the full development workflow works after all
infrastructure changes, and update documentation to reflect the new config
directory structure and service layer pattern.

### Changes

1. **Verify `npm run dev` end-to-end**:
   - Database starts via `docker-compose.dev.yml`
   - Prisma migrations apply
   - Server starts and connects to the database
   - Client starts and proxies API requests
   - Counter API responds correctly
   - Admin dashboard loads
   - Health check passes

2. **Verify existing tests pass**:
   - Run `npm run test:server` and confirm zero failures
   - Confirm no new warnings related to config loading or service
     initialization

3. **Update `docs/secrets.md`**:
   - Document the new `config/` directory structure
   - Explain the public/secret split
   - Update decryption and editing instructions for the new paths
   - Note that `secrets/` is preserved until stakeholder verification

4. **Update `docs/template-spec.md`**:
   - Update the repository layout diagram to include `config/`
   - Add or update the service layer section to describe `ServiceRegistry`
   - Update the contracts directory in the layout
   - Update development environment instructions to reference
     `docker-compose.dev.yml`

## Acceptance Criteria

- [ ] `npm run dev` starts successfully end-to-end (DB, migrations, server, client)
- [ ] Counter API works (GET, POST increment/decrement)
- [ ] Admin dashboard loads and functions correctly
- [ ] Health check endpoint responds
- [ ] `npm run test:server` passes with zero failures
- [ ] No new warnings related to config or service initialization
- [ ] `docs/secrets.md` updated with `config/` directory documentation
- [ ] `docs/template-spec.md` updated with new repository layout
- [ ] `docs/template-spec.md` updated with ServiceRegistry documentation
- [ ] `docs/template-spec.md` updated with `docker-compose.dev.yml` reference

## Testing

- **Existing tests to run**: `npm run test:server` — full suite must pass
- **Manual verification**: Complete walkthrough of `npm run dev` from a
  clean state, exercising counter, admin, and health endpoints
- **Doc review**: Read through updated docs to confirm accuracy and
  completeness
