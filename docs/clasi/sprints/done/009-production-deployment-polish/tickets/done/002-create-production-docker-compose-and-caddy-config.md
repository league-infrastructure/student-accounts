---
id: '002'
title: Create production Docker Compose and Caddy config
status: done
use-cases:
- SUC-001
depends-on:
- '001'
---

# Create production Docker Compose and Caddy config

## Description

Create the production `docker-compose.yml` for Docker Swarm deployment. Set up
`config/prod/` with production environment values. Add a `build:docker` npm
script to the root `package.json`.

The production stack runs a single server service (Express serves both API and
built client), PostgreSQL, Swarm secrets, and Caddy reverse proxy labels on
the Docker Swarm overlay network.

### Changes

1. **`docker-compose.yml`** — Rewrite as the production Swarm stack:
   - **`server` service**: Built from `docker/Dockerfile.server`, port 3000
     (internal only), Caddy labels for reverse proxy routing
     (`caddy: ${APP_DOMAIN}`, `caddy.reverse_proxy: "{{upstreams 3000}}"`),
     Swarm secrets mounted, depends on `db`, deploy config with rolling
     update settings.
   - **`db` service**: `postgres:16-alpine`, persistent volume for pgdata,
     health check via `pg_isready`, secret for `db_password`.
   - **Secrets**: Declared as `external: true` — must be created before
     deploy via `docker secret create`.
   - **Networks**: Overlay network shared with Caddy proxy.
   - Use `${TAG:-latest}` for image tag to support rolling updates.

2. **`config/prod/public.env`** — Non-secret production configuration:
   - `NODE_ENV=production`
   - `APP_DOMAIN=collegenavigator.jtlapp.net`
   - `PORT=3000`
   - OAuth callback URLs (public, not secret)

3. **`config/prod/secrets.env`** — Template/example for SOPS-encrypted
   production secrets. If SOPS is configured, encrypt it. Otherwise, create
   as a `.example` file listing required secret keys:
   - `DATABASE_URL`, `SESSION_SECRET`, `MCP_DEFAULT_TOKEN`
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `ADMIN_PASSWORD`

4. **Root `package.json`** — Add `build:docker` script:
   `docker build -f docker/Dockerfile.server -t collegenav-server:${TAG:-latest} .`

5. **Rename existing dev compose** — If the current `docker-compose.yml` is
   used for dev, rename it to `docker-compose.dev.yml` and update any npm
   scripts that reference it (e.g., `dev:docker`).

## Acceptance Criteria

- [ ] `docker-compose.yml` defines server + db services for Docker Swarm
- [ ] Server service has Caddy labels for reverse proxy (`caddy` and `caddy.reverse_proxy`)
- [ ] Server service mounts all required Swarm secrets (database_url, session_secret, mcp_default_token, github_client_id, github_client_secret, google_client_id, google_client_secret, admin_password)
- [ ] DB service uses `postgres:16-alpine` with persistent volume and health check
- [ ] Secrets are declared as `external: true`
- [ ] `config/prod/public.env` exists with NODE_ENV, APP_DOMAIN, PORT
- [ ] `config/prod/secrets.env` (or `.example`) lists all required secret keys
- [ ] `npm run build:docker` builds the production image successfully
- [ ] `docker compose config` validates the compose file without errors
- [ ] Dev compose file is preserved and `npm run dev` / `npm run dev:docker` still work

## Testing

- **Existing tests to run**: `npm run dev` (verify dev workflow is not broken by compose rename)
- **New tests to write**: None (Swarm deploy verified in ticket 004)
- **Verification commands**:
  - `npm run build:docker`
  - `docker compose -f docker-compose.yml config` (validate production compose)
  - `docker compose -f docker-compose.dev.yml config` (validate dev compose still works)
