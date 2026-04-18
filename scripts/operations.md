# Operations Reference

Commands agents can run when asked. These are not in package.json because
humans don't type them — agents execute them directly.

## Dev Server

The `npm run dev` script auto-detects SQLite vs Postgres from DATABASE_URL.
Under the hood it runs one of these flows:

### SQLite mode (default)

```bash
# Start server (generate client + push schema + watch)
cd server && ./prisma/sqlite-push.sh && npm run dev

# Start client (waits for server health first)
cd client && npx wait-on http://localhost:3000/api/health && npx vite --host
```

Run both concurrently:
```bash
concurrently -n server,client -c green,magenta \
  "cd server && ./prisma/sqlite-push.sh && npm run dev" \
  "cd client && npx wait-on http://localhost:3000/api/health && npx vite --host"
```

### Postgres mode

Requires Docker. Start the database container first:
```bash
set -a && . ./.env && set +a
DOCKER_CONTEXT=$DEV_DOCKER_CONTEXT docker compose -f docker-compose.dev.yml up db
```

Then in separate terminals:
```bash
# Server (wait for DB, generate, migrate, start)
set -a && . ./.env && set +a
./docker/wait-for-db.sh
cd server && npx prisma generate && npx prisma migrate dev && npm run dev

# Client
cd client && npx wait-on http://localhost:3000/api/health && npx vite --host
```

### Full Docker stack

Run everything (db + server + client) in Docker:
```bash
set -a && . ./.env && set +a
DOCKER_CONTEXT=$DEV_DOCKER_CONTEXT docker compose -f docker-compose.dev.yml up --build
```

Stop:
```bash
set -a && . ./.env && set +a
DOCKER_CONTEXT=$DEV_DOCKER_CONTEXT docker compose -f docker-compose.dev.yml down
```

## Database

### Run migrations (inside Docker)

```bash
set -a && . ./.env && set +a
DOCKER_CONTEXT=$DEV_DOCKER_CONTEXT docker compose -f docker-compose.dev.yml exec server npx prisma migrate dev
```

### Prisma Studio

```bash
cd server && npx prisma studio
```

### Generate Prisma client

```bash
cd server && npx prisma generate
```

### Seed database

```bash
cd server && npx tsx prisma/seed.ts
```

## Build

### Build server + client

```bash
cd server && npm run build && cd ../client && npm run build
```

### Build Docker image

```bash
docker build -f docker/Dockerfile.server -t collegenav-server:${TAG:-latest} .
```

## Testing

### Server tests (Vitest)

```bash
cd server && npx vitest run
```

### Client tests (Vitest)

```bash
cd client && npx vitest run
```

### E2E tests (Playwright)

Requires running dev server.
```bash
npx playwright test
```

## Deploy

See `scripts/deploy.sh` and `.claude/rules/deployment.md`.

## Version

See `scripts/version.sh`. Bumps the version in package.json using date-based format.
