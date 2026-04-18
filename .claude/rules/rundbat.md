# rundbat — Deployment Expert

When working on tasks that involve deployment, Docker containers, or
environment setup, use **rundbat CLI** for setup and deploy, and
**docker compose** / **dotconfig** for day-to-day operations.

## rundbat CLI commands

```bash
rundbat init               # Set up rundbat in a project
rundbat init-docker        # Generate Docker artifacts
rundbat deploy <name>      # Deploy to a remote host
rundbat deploy-init <name> # Set up a deployment target
```

## Docker operations

Use docker compose directly for container lifecycle:

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs
```

## Configuration access

Read config through dotconfig, not by reading files directly:

```bash
# All config merged
dotconfig load -d <env> --json --flat -S

# Project config
dotconfig load -d <env> --file rundbat.yaml -S
```

Write config through dotconfig — never edit `config/` files directly.
