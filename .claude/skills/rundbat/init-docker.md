# init-docker

Scaffold a `docker/` directory for the project. Produces a self-contained
deployment package: Dockerfile, docker-compose.yml, Justfile, and
.env.example.

## When to use

- "Set up Docker for this project"
- "Containerize this app"
- "I need a compose file"

## Prerequisites

- Project initialized (`rundbat.yaml` exists — run `rundbat init` first)

## Steps

1. Run the generator:
   ```bash
   rundbat init-docker --json
   ```

   This auto-detects the framework and generates all artifacts.

2. Review the generated files in `docker/`:
   - `Dockerfile` — framework-specific multi-stage build
   - `docker-compose.yml` — app + database services with health checks
   - `Justfile` — deployment recipes (build, up, down, deploy, db ops)
   - `.env.example` — environment variable template

## What you get in the Dockerfile

rundbat's templates emit Dockerfiles that already meet Docker's High/Medium
Build Best Practices:

- **Multi-stage builds** — Node (2 stages), Python (2 stages, venv in
  `/opt/venv`), Astro (3 stages)
- **Non-root `USER`** — `USER node` (Node), `USER appuser` (Python, UID
  1000), `nginxinc/nginx-unprivileged:alpine` runtime (Astro)
- **`HEALTHCHECK`** — Node uses stdlib `http.get`, Python uses
  `urllib.request`, Astro uses `wget --spider`. All hit `/` on the
  container's exposed port.
- **BuildKit cache mounts** — `--mount=type=cache,target=/root/.npm`
  and `/root/.cache/pip` so repeated builds don't re-download packages.
  The `# syntax=docker/dockerfile:1` header is emitted automatically.
- **`COPY --chown=…`** in the runtime stage so files are owned by the
  runtime user, not root.

See `docker-best-practices` for the full checklist, including items
rundbat does *not* enforce by default (digest pinning, OCI `LABEL`
metadata) and when to add them.

3. Test locally:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```

## Generated Justfile recipes

- `just build` — build the app image
- `just up` / `just down` — compose lifecycle
- `just deploy` — deploy via `rundbat deploy`
- `just logs` — tail service logs
- `just psql` / `just mysql` — database shell (if applicable)
- `just db-dump` / `just db-restore` — database backup/restore

## Caddy Reverse Proxy

If your deployment target runs Caddy, include reverse proxy labels in
the compose file:

1. Run `rundbat probe <deployment>` to detect Caddy and save the result.
2. Re-run `rundbat init-docker --hostname <your-hostname>` to include labels.

If `reverse_proxy: caddy` is already in your deployment config but you
haven't provided `--hostname`, rundbat will print a reminder.

## Outputs

```
docker/
  Dockerfile
  docker-compose.yml
  .env.example
  Justfile
```
