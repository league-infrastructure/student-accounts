# Docker Node Application Template

A Node.js web application template with Express, React, Prisma, and SQLite. Clone it, run the install script, and start building.

The default home page is a counter demo: two named counters (`alpha` and `beta`) that any logged-in user can increment. Log in with `user` / `pass` (USER role) or `admin` / `admin` (ADMIN role) — no OAuth setup required.

## Getting Started

```bash
# 1. Clone the template
git clone <your-repo-url> my-app
cd my-app

# 2. Run the install script
./scripts/install.sh

# 3. Start the dev server
npm run dev
```

That's it. The app starts with SQLite — no Docker, no database setup required.

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api

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
npm run dev:postgres     # PostgreSQL mode (requires Docker)
npm run dev:docker       # Full stack in Docker
```

To switch to PostgreSQL, edit `DATABASE_URL` in your `.env`:
```
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

## Testing

```bash
npm run test:server   # Backend API (Vitest)
npm run test:client   # Frontend components (Vitest)
npm run test:e2e      # End-to-end (Playwright)
```

## Documentation

| Guide | Contents |
|-------|----------|
| [docs/testing.md](docs/testing.md) | Test strategy and guidelines |
| `.claude/rules/setup.md` | Detailed setup and troubleshooting |
| `.claude/rules/deployment.md` | Production deployment |
| `.claude/rules/template-spec.md` | Architecture and conventions |
