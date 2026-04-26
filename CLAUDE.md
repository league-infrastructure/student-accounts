# Docker Node Application Template

This is a template repo for building new web applications with AI and deploying them to
Docker.

**MANDATORY: Before doing ANY work that involves code or planning on code, you MUST call `get_se_overview()` to load the software engineering process. Do this at the start of every conversation. No exceptions.**

## External Tools

This project uses external CLI tools for configuration and database
management. **Their agent instructions are canonical** — when in doubt,
run the agent command to get up-to-date instructions rather than relying
solely on the docs in this repo.

| Tool | Purpose | Agent instructions |
|------|---------|-------------------|
| **dotconfig** | Secrets & `.env` configuration (SOPS + age encryption, layered env files) | `dotconfig agent` |
| **rundbat** | Dev/prod database lifecycle (Docker Postgres containers, credentials) | `rundbat mcp --help` |
| **clasi** | SE process management (sprints, tickets, architecture) | `get_se_overview()` MCP tool |

When working with secrets or `.env` files, follow `dotconfig agent`
instructions. When working with database containers or connection
strings, use the `rundbat` MCP tools (available via `.mcp.json`).
The docs below provide project-specific context but **must not conflict**
with the tool instructions above — if they do, the tool instructions win.

## Documentation

Human-facing docs live in `docs/`. Consult them for reference:

- [docs/testing.md](docs/testing.md) — Full test strategy and patterns

Agent behavioral rules are in `.claude/rules/` (auto-loaded):

- `testing.md` — Test authentication, assertions, layer separation, SQLite
- `architecture.md` — Service layer, API conventions, database philosophy, dual DB support
- `secrets.md` — Secrets handling, security rules, config structure, onboarding
- `rundbat.md` — Database and deployment MCP tools
- `api-integrations.md` — GitHub, Google OAuth setup and integration patterns
- `deployment.md` — Production builds, deployment, database management
- `setup.md` — First-time checkout, install script, dev server
- `template-spec.md` — Technology decisions, project structure, conventions

<!-- CLASI:START -->
# CLASI Software Engineering Process

This project uses the CLASI SE process. Your role and workflow are
defined in `.claude/agents/team-lead/agent.md` — read it at session start.

Available skills: run `/se` for a list.
<!-- CLASI:END -->

<!-- RUNDBAT:START -->
## rundbat — Deployment Expert

This project uses **rundbat** to manage Docker-based deployment
environments. rundbat handles Docker Compose generation, per-deployment
environment config (via dotconfig), secret management, and deployment
to remote Docker hosts.

**If a task involves Docker containers, docker-compose, deployment,
environment variables, secrets, or connection strings — use rundbat.**

Run `rundbat --instructions` for detailed agent-oriented instructions,
including the full help text for every subcommand. `rundbat --help`
shows the command list.

### Common commands

| Command | Purpose |
|---|---|
| `rundbat init` | Set up rundbat in a project |
| `rundbat generate` | Generate Docker artifacts from `config/rundbat.yaml` |
| `rundbat up <env>` | Start a deployment (checks out env from dotconfig) |
| `rundbat down <env>` | Stop a deployment |
| `rundbat restart <env>` | Restart (down + up; `--build` to rebuild) |
| `rundbat logs <env>` | Tail container logs |
| `rundbat deploy <env>` | Deploy to a remote Docker host |
| `rundbat deploy-init <env> --host ssh://...` | Register a remote target |

Most commands support `--json` for machine-parseable output, and `-v`
to print the shell commands they run.

### Configuration

Configuration is managed by dotconfig — **never edit `config/` files
or `docker/docker-compose.*.yml` directly**. Edit `config/rundbat.yaml`
and re-run `rundbat generate`; use `dotconfig` for env vars and secrets.

Read merged config: `dotconfig load -d <env> --json --flat -S`

Key locations:
- `config/rundbat.yaml` — Project-wide config (app name, deployments)
- `config/{env}/public.env` — Non-secret environment variables
- `config/{env}/secrets.env` — SOPS-encrypted credentials

### Reference files

`rundbat init` installs these files into `.claude/` for task-specific
guidance. Read them directly, or run `rundbat --instructions` for a
consolidated view that also dumps every subcommand's help text.

Rules:
- `.claude/rules/rundbat.md`

Agents:
- `.claude/agents/deployment-expert.md`

Skills (task-specific runbooks):
- `.claude/skills/rundbat/astro-docker.md`
- `.claude/skills/rundbat/deploy-init.md`
- `.claude/skills/rundbat/deploy-setup.md`
- `.claude/skills/rundbat/dev-database.md`
- `.claude/skills/rundbat/diagnose.md`
- `.claude/skills/rundbat/docker-best-practices.md`
- `.claude/skills/rundbat/docker-secrets-build.md`
- `.claude/skills/rundbat/docker-secrets-compose.md`
- `.claude/skills/rundbat/docker-secrets-swarm.md`
- `.claude/skills/rundbat/docker-secrets.md`
- `.claude/skills/rundbat/docker-swarm-deploy.md`
- `.claude/skills/rundbat/generate.md`
- `.claude/skills/rundbat/github-deploy.md`
- `.claude/skills/rundbat/init-docker.md`
- `.claude/skills/rundbat/manage-secrets.md`
<!-- RUNDBAT:END -->
