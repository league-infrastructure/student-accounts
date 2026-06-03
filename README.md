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
| Database | SQLite (dev default) or PostgreSQL (production) |
| ORM | Prisma 7 |
| AI process | [CLASI](https://github.com/ericbusboom/claude-agent-skills) |

## Development

```bash
npm run dev              # SQLite mode (default, no Docker needed)
npm run deploy:dev       # Full stack in Docker (scripts/up.sh dev)
```

To switch to PostgreSQL, set `DATABASE_URL` to a `postgresql://` URL in
`config/dev/public.env` and regenerate `.env` (step 2 above). `scripts/dev.sh`
detects the postgres URL and runs `prisma migrate deploy` instead of `db push`:
```
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

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
| `.claude/rules/deployment.md` | Production deployment |
| `.claude/rules/template-spec.md` | Architecture and conventions |
