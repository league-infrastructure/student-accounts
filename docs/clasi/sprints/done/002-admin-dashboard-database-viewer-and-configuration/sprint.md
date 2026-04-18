---
id: '002'
title: "Admin Dashboard \u2014 Database Viewer and Configuration"
status: done
branch: sprint/002-admin-dashboard-database-viewer-and-configuration
use-cases: []
---

# Sprint 002: Admin Dashboard — Database Viewer and Configuration

## Goals

Build a password-protected admin area at `/admin` that provides:

1. A read-only database browser (list tables, view records)
2. A configuration panel for managing API credentials and tokens at runtime
3. An environment info page (Node version, uptime, deployment mode)
4. A log viewer for recent server logs
5. A session viewer showing active sessions
6. Config export to `.env` snippet
7. New secret entries for GitHub token, storage repo, Claude key, and OpenAI key

The admin area is a permanent part of the template — it must be structurally
separate from the demo/example application so it survives when the demo is
deleted.

## Problem

After deploying a project from this template, there is no way to:

- Inspect what is in the database without connecting directly via `psql` or
  Prisma Studio
- Configure API credentials (OAuth client IDs/secrets, API keys) without
  editing `.env` and restarting the server
- See at a glance which integrations are configured and what their current
  values are
- Check server health, uptime, or recent log output without SSH access
- See who has active sessions

Developers and administrators need a lightweight built-in tool for these tasks.

## Solution

Add a `/admin` section to the application with the following views:

1. **Environment Info** — Node version, uptime, memory usage, deployment
   mode, database connection status.

2. **Database Viewer** — A table list pulled from Postgres
   `information_schema`, with drill-down to view rows in any table. Read-only
   in this sprint (no insert/update/delete).

3. **Configuration Panel** — A form-based UI for viewing and updating API
   credentials. Values are persisted to a new `Config` table in Postgres
   (plaintext) and loaded by the server at startup and on change. Includes
   an export button to download current config as a `.env` snippet.

4. **Log Viewer** — Tail recent pino log entries from an in-memory ring
   buffer.

5. **Session Viewer** — List active sessions from the session table with
   expiry times.

Access is gated by an `ADMIN_PASSWORD` secret. The admin enters the password
once per session; the server validates it and stores an `isAdmin` flag in the
session.

## Success Criteria

- [ ] Navigating to `/admin` prompts for the admin password
- [ ] Correct password grants access; incorrect password shows an error
- [ ] Admin session persists across page reloads (PostgreSQL session store)
- [ ] Environment page shows Node version, uptime, memory, deployment mode
- [ ] Database Viewer lists all user tables (excludes internal Prisma/session tables)
- [ ] Clicking a table shows its rows with column headers, paginated
- [ ] Configuration panel displays current values for all API credentials
- [ ] Saving non-OAuth credentials takes effect immediately without restart
- [ ] OAuth credential changes show a "restart required" notice
- [ ] Config export downloads a `.env`-formatted snippet
- [ ] Log viewer shows recent server log entries
- [ ] Session viewer lists active sessions with expiry
- [ ] New secrets (ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_STORAGE_REPO, ANTHROPIC_API_KEY, OPENAI_API_KEY) are in the example env files
- [ ] Admin routes and pages are in separate files from the demo application
- [ ] Deleting the demo app files does not break the admin area

## Scope

### In Scope

- Admin authentication via shared password (ADMIN_PASSWORD secret)
- Admin session flag in express-session
- Backend: admin auth middleware, environment info endpoint, database
  introspection endpoints, config CRUD endpoints, log buffer endpoint,
  session list endpoint
- Frontend: admin login page, environment info page, database table list,
  record viewer, config form with export, log viewer, session viewer
- React Router setup (needed to separate `/admin` from the demo app)
- Simple admin layout with sidebar navigation
- New `Config` model in Prisma for persisted key-value configuration
- Server-side config loader that reads from Config table and falls back to env vars
- In-memory pino log ring buffer for the log viewer
- New secret entries: ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_STORAGE_REPO, ANTHROPIC_API_KEY, OPENAI_API_KEY
- Demo app updated with a link to `/admin`

### Out of Scope

- Role-based access control or user accounts for admin (single password only)
- Database record editing, inserting, or deleting (read-only viewer)
- GitHub file read/write API implementation (just store the token and repo name)
- Actually calling Claude or OpenAI APIs (just store the keys)
- Admin audit logging
- Encryption of Config table values (plaintext is acceptable)
- Log persistence or log file management (in-memory buffer only)
- Session invalidation from the admin UI (view-only)

## Test Strategy

- **Server tests**: Admin auth middleware (correct/incorrect password, session
  persistence), database introspection endpoints (table list, row fetch),
  config CRUD endpoints, environment info endpoint
- **Client tests**: Admin login form validation, config form rendering
- **E2E**: Full admin login flow, navigate database viewer, update a config value

## Architecture Notes

- **Separation from demo**: Admin routes live in `server/src/routes/admin/`
  and admin pages in `client/src/pages/admin/`. The demo app's
  `ExampleIntegrations.tsx` only adds a link to `/admin` — no shared state
  or components.
- **React Router**: This sprint introduces React Router to the frontend.
  The demo app moves to `/` (or `/demo`), admin lives at `/admin/*`.
- **Config precedence**: Environment variables take precedence over database
  Config values. This means secrets files remain the source of truth for
  deployment, but the admin UI can set values for credentials not yet in the
  environment.
- **Config storage**: Plaintext in the Config table. The database is already
  access-controlled and secrets are encrypted at rest via SOPS.
- **OAuth hot-reload**: Changing OAuth credentials (client ID/secret) via the
  config panel saves the values but shows a "restart required" notice since
  Passport strategies are registered at startup. Non-OAuth keys (tokens, API
  keys) take effect immediately via the config cache.
- **Database introspection**: Use `information_schema.tables` and
  `information_schema.columns` via `prisma.$queryRaw` rather than adding a
  dependency on `pg` directly.
- **Admin password**: Constant-time string comparison
  (`crypto.timingSafeEqual`) against `ADMIN_PASSWORD` env var. No hashing,
  no user model.
- **Log buffer**: Pino custom destination that writes to both stdout and an
  in-memory ring buffer (last ~500 entries). The admin log viewer reads from
  this buffer.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, technical plan)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

(To be created after sprint approval.)
