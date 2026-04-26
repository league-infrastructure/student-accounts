# generate

Generate Docker artifacts from rundbat.yaml configuration.

## When to use

- "Generate Docker files"
- "Run rundbat generate"
- "Create Docker artifacts"
- "Set up Docker for this project"

## What it produces

`rundbat generate` reads `rundbat.yaml` and creates:

- **Per-deployment compose files**: `docker/docker-compose.<name>.yml` for each
  deployment (dev, local, test, prod, etc.)
- **Dockerfile**: Framework-aware, multi-stage build
- **entrypoint.sh**: Startup script with SOPS/age key setup
- **Justfile**: Named recipes per deployment (`dev_up`, `prod_build`, etc.)
- **.env files**: `docker/.<name>.env` per deployment
- **.dockerignore**: Excludes config, docs, tests from build context
- **GitHub workflows**: `build.yml` + `deploy.yml` if any deployment uses
  `build_strategy: github-actions`

## Usage

```bash
# Generate all artifacts
rundbat generate

# Regenerate only one deployment
rundbat generate --deployment prod

# JSON output
rundbat generate --json
```

## When to re-run

Re-run `rundbat generate` after:
- Adding or removing deployments in `rundbat.yaml`
- Changing services, build strategy, or deploy mode
- Changing hostnames or Caddy settings
- Updating framework dependencies (e.g., switching from Express to Astro)
- Upgrading rundbat itself — new template improvements (hardened
  defaults, additional best-practice directives) ship via the
  generators, so a regenerate is how you pick them up

## Per-deployment compose files

Each deployment gets its own compose file tailored to its config:

- **dev/local**: `build:` stanza, local Docker context
- **prod with github-actions**: `image:` stanza pointing to GHCR
- **Caddy deployments**: labels for reverse proxy auto-config
- **Service filtering**: only includes services listed in the deployment

## Relationship to init-docker

`rundbat generate` replaces `rundbat init-docker`. The old command still
works but prints a deprecation notice and delegates to `generate`.
