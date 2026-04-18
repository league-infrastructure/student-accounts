---
id: '002'
title: Create docker-compose.dev.yml and update dev scripts
status: todo
use-cases:
- SUC-002
depends-on:
- '001'
---

# Create docker-compose.dev.yml and update dev scripts

## Description

Create a standalone Docker Compose file for the development database and
update npm scripts so that `npm run dev` starts the full local development
stack (DB in Docker, server and client natively). Also update the server
to serve static files in production mode.

### Changes

1. **Create `docker-compose.dev.yml`** with PostgreSQL only:
   - Image: `postgres:16-alpine`
   - Port mapping: `5433:5432`
   - Environment: `POSTGRES_USER=app`, `POSTGRES_PASSWORD=devpassword`,
     `POSTGRES_DB=app`
   - Volume: `pgdata` for persistent data
   - Health check: `pg_isready -U app -d app` (interval 5s, timeout 3s,
     retries 5)

2. **Update npm scripts in root `package.json`**:
   - `dev` — starts DB container via `docker-compose.dev.yml`, waits for
     health, runs Prisma migrations, then starts server and client
     concurrently
   - `dev:docker` — updated to use the new compose file as needed

3. **Update server to serve static files** in production mode so the
   Express server can serve the built Vite client assets when running
   without the Vite dev server.

4. **Ensure `DATABASE_URL`** flows correctly from `config/dev/public.env`
   through `.env` to the server and Prisma CLI.

## Acceptance Criteria

- [ ] `docker-compose.dev.yml` exists at project root with PostgreSQL only
- [ ] PostgreSQL container maps port 5433 to 5432
- [ ] Health check configured with `pg_isready`
- [ ] `pgdata` volume defined for data persistence
- [ ] `npm run dev` starts DB container, runs migrations, starts server and client
- [ ] Database health check passes before server attempts to connect
- [ ] Counter API works (GET, POST increment/decrement)
- [ ] Admin dashboard loads correctly
- [ ] Vite proxies `/api` requests to Express on port 3000
- [ ] Server serves static files in production mode

## Testing

- **Existing tests to run**: `npm run test:server` to verify server still
  starts and routes respond correctly
- **Manual verification**: Run `npm run dev`, confirm all three components
  start, visit `http://localhost:5173`, verify counter and admin pages work
