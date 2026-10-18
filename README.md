# Docker Node Application Template

A Node.js web application template with Express, React, Prisma, and SQLite. Install dependencies, generate the dev `.env`, and start building.

The default home page is a counter demo: two named counters (`alpha` and `beta`) that any logged-in user can increment. Log in with `user` / `pass` (USER role) or `admin` / `admin` (ADMIN role) — no OAuth setup required.

## Getting Started

```bash
# 1. Install dependencies (server and client are separate packages)
( cd server && npm install )
( cd client && npm install )

# 2. Generate the root .env from config/dev/ (decrypts secrets via dotconfig)
scripts/config-load.sh dev > .env

# 3. Start the dev server (runs prisma generate + db push, then server + client)
npm run dev
```

The app starts with SQLite — no Docker, no database setup required. `npm run dev`
(→ `scripts/dev.sh`) sources the root `.env`, so step 2 must run first or Prisma
fails with "datasource.url property is required".

- Frontend: http://localhost:5173
- Backend API: http://localhost:5201/api

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express + TypeScript |
| Frontend | Vite + React + TypeScript |
| Database | SQLite (dev, tests and production; see [Production database](#production-database)) |
| ORM | Prisma 7 |
| AI process | [CLASI](https://github.com/ericbusboom/claude-agent-skills) |

## Development

```bash
npm run dev              # SQLite mode (default, no Docker needed)
npm run deploy:dev       # Full stack in Docker (scripts/up.sh dev)
```

PostgreSQL is supported for local experiments but is not what production
runs (see below). To try it, set `DATABASE_URL` to a `postgresql://` URL in
`config/dev/public.env` and regenerate `.env` (step 2 above). `scripts/dev.sh`
detects the postgres URL and runs `prisma migrate deploy` instead of `db push`:
```
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

## Production database

Production runs **SQLite**, not Postgres. The Swarm stack (`docker-stack.yaml`)
sets `DATABASE_URL=file:/app/data/app.db` on the `app-data` volume and pins the
single replica to a manager node so the volume always lands on the same host.
The safety net is the backup job: the `daily-backup` and `weekly-backup`
scheduled jobs (Admin → Scheduled Jobs) copy the database to DigitalOcean
Spaces (`DO_SPACES_BUCKET`, credentials `DO_SPACES_KEY` / `DO_SPACES_SECRET`).

The Postgres adapter (`@prisma/adapter-pg`) is still wired in
`server/src/services/prisma.ts` and is selected automatically for a
`postgresql://` URL, but no deployment uses it and the Prisma datasource
provider is `sqlite`. Decision 2026-10-18 (sprint 002, ticket 009): stay on
SQLite; if the laptop roster sync's write load ever warrants it, moving to the
managed Postgres cluster is its own issue. Deploy steps and the migration
story are in [docs/deploy.md](docs/deploy.md).

## Testing

```bash
npm run test:server   # Backend API (Vitest)
npm run test:client   # Frontend components (Vitest)
```

## Documentation

| Guide | Contents |
|-------|----------|
| [docs/testing.md](docs/testing.md) | Test strategy and guidelines |
| [docs/oauth-provider.md](docs/oauth-provider.md) | OAuth 2.0 provider — integrator guide |
| `.claude/rules/setup.md` | Detailed setup and troubleshooting |
| [docs/deploy.md](docs/deploy.md) | Production deploy runbook (Docker Swarm, SQLite, smoke checks, rollback) |
| `.claude/rules/template-spec.md` | Architecture and conventions |
