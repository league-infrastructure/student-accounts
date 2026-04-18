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

# CLASI Software Engineering Process

This project uses the CLASI SE process. Your role and workflow are
defined in `.claude/agents/team-lead/agent.md` — read it at session start.

Available skills: run `/se` for a list.

<!-- RUNDBAT:START -->
## rundbat — Deployment Expert

This project uses **rundbat** to manage Docker-based deployment
environments. rundbat is an MCP server that handles database provisioning,
secret management, and environment configuration.

**If you need a database, connection string, deployment environment, or
anything involving Docker containers or dotconfig — use the rundbat MCP
tools.** Do not run Docker or dotconfig commands directly.

Run `rundbat mcp --help` for the full tool reference, or call
`discover_system` to see what is available.

### Quick Reference

| Tool | Purpose |
|---|---|
| `discover_system` | Detect OS, Docker, dotconfig, Node.js |
| `init_project` | Initialize rundbat in a project |
| `create_environment` | Provision a database environment |
| `get_environment_config` | Get connection string (auto-restarts containers) |
| `set_secret` | Store encrypted secrets via dotconfig |
| `start_database` / `stop_database` | Container lifecycle |
| `health_check` | Verify database connectivity |
| `validate_environment` | Full environment validation |
| `check_config_drift` | Detect app name changes |

### Configuration

Configuration is managed by dotconfig. Run `dotconfig agent` for full
documentation on how dotconfig works. Key locations:

- `config/rundbat.yaml` — Project-wide rundbat config (app name, naming templates)
- `config/{env}/secrets.env` — SOPS-encrypted credentials
- `config/keys/` — SSH keys (encrypted via dotconfig key management)
<!-- RUNDBAT:END -->
