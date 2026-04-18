---
name: deployment
description: Production builds, Docker deployment, database management, and environment configuration
paths:
  - "Dockerfile"
  - "docker/**"
  - "scripts/deploy*"
  - "config/rundbat.yaml"
  - "docker-compose*.yml"
---
# Deployment Guide

> **Agents:** Use the `rundbat` MCP tools for all database and deployment
> environment tasks. Run `rundbat mcp --help` for the full tool reference.
> Use `dotconfig agent` for secrets and configuration management.

## Overview

This project uses **rundbat** to manage deployment environments (dev, prod,
staging, etc.) and **dotconfig** to manage secrets and configuration. Rundbat
handles database provisioning, container lifecycle, and connection strings.
Dotconfig handles layered `.env` assembly, SOPS-encrypted secrets, and
per-developer overrides.

Production runs on Docker — the specific orchestrator (Swarm, Compose,
Kubernetes, etc.) depends on how rundbat is configured for your target
environment.

## Architecture

A single server image contains both the Express backend and the built React
frontend (served via `express.static` in production mode).

```
Client → Reverse Proxy → server:3000 → Express (API + static files)
                        → db:5432    → PostgreSQL
```

## Database Management

Database environments are managed by **rundbat** via its MCP tools.

**Agents:** Call `get_environment_config` at the start of a session. It
returns a working connection string and auto-restarts stopped containers.

Key rundbat MCP tools:

| Tool | Purpose |
|------|---------|
| `discover_system` | Detect OS, Docker, dotconfig, Node.js |
| `init_project` | Initialize rundbat for a new project |
| `create_environment` | Provision a database environment |
| `get_environment_config` | Get connection string (auto-restarts containers) |
| `start_database` / `stop_database` | Container lifecycle |
| `health_check` | Verify database connectivity |
| `validate_environment` | Full environment validation |

## Secrets & Configuration

Secrets are managed by **dotconfig**. See `.claude/rules/secrets.md`
for the project-specific secrets inventory, and run `dotconfig agent` for
full usage instructions.

```bash
# Load config for development
dotconfig load -d dev -l <username>

# Edit and save back
dotconfig save
```

## Building

```bash
# Build server + client locally
npm run build

# Build production Docker image
npm run build:docker
```

## Deploying

Deployment procedures depend on your target environment's rundbat
configuration. Use the rundbat MCP tools or consult your environment's
specific setup.

For migrations after deployment:

```bash
npx prisma migrate deploy
```

## Troubleshooting

**Dev database won't start / port conflict**
Use `rundbat` MCP tools or check `docker ps` for port conflicts. Each
project's dev database should use a unique port (configured via dotconfig).

**Container won't start**
Check container logs via Docker.

**Migration failures**
Connect to the database directly and check the migration state.

**Secrets not available**
Run `dotconfig load -d <env> -l <username>` to regenerate `.env`.
