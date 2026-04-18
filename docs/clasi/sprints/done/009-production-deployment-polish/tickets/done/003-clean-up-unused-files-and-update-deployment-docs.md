---
id: '003'
title: Clean up unused files and update deployment docs
status: done
use-cases:
- SUC-004
depends-on:
- '001'
- '002'
---

# Clean up unused files and update deployment docs

## Description

Remove stale Docker files and the old `secrets/` directory. Update
`docs/deployment.md` with the new production deployment workflow. Update
`package.json` metadata as needed.

The Docker directory contains files from the original template that are no
longer used now that Express serves the client in production (no separate
Caddy client container). The `secrets/` directory was superseded by `config/`
in sprint 004 but was never removed.

### Changes

1. **Remove unused Docker files**:
   - `docker/Dockerfile.client.dev` — Client is served by Express, no
     separate container needed
   - `docker-compose.prod.yml` — Replaced by the new `docker-compose.yml`
     from ticket 002
   - Check for any other stale Docker files (e.g., `docker/Caddyfile.client`,
     `docker/Dockerfile.client`) and remove if unused

2. **Remove old `secrets/` directory** (after stakeholder verification):
   - `secrets/dev.env` — Migrated to `config/dev/secrets.env`
   - `secrets/dev.env.example` — Migrated to `config/dev/`
   - `secrets/prod.env` — Migrated to `config/prod/secrets.env`
   - `secrets/prod.env.example` — Migrated to `config/prod/`
   - Remove the `secrets/` directory itself
   - If stakeholder has not verified, add a deprecation note instead of
     deleting

3. **Update `docs/deployment.md`** — Rewrite with the new production
   workflow:
   - Build: `npm run build:docker`
   - Tag and push to registry
   - Create Swarm secrets from `config/prod/secrets.env`
   - Deploy: `TAG=<version> docker stack deploy -c docker-compose.yml <stackname>`
   - Run migrations: `docker exec ... npx prisma migrate deploy`
   - Verify: health checks, endpoint testing, Caddy routing
   - Rolling updates: deploy new tag
   - Rollback: deploy previous tag
   - Document the local dev workflow (`npm run dev`) for reference

4. **Update `package.json` metadata** — Verify project name, description,
   and any stale references are current.

## Acceptance Criteria

- [ ] `docker/Dockerfile.client.dev` is removed
- [ ] `docker-compose.prod.yml` is removed (if it exists)
- [ ] Any other unused Docker files (Caddyfile.client, Dockerfile.client) are removed
- [ ] `secrets/` directory is removed (or marked deprecated if stakeholder has not verified)
- [ ] `docs/deployment.md` documents the complete production workflow (build, tag, push, create secrets, deploy, migrate, verify)
- [ ] `docs/deployment.md` documents rolling updates and rollback
- [ ] `docs/deployment.md` documents the local dev workflow
- [ ] `package.json` metadata is accurate
- [ ] No broken references to removed files exist in other docs or scripts

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client` (verify no test references removed files)
- **New tests to write**: None
- **Verification command**: `git grep -l 'Dockerfile.client\|docker-compose.prod\|secrets/dev.env\|secrets/prod.env'` (should return no hits outside of git history)
