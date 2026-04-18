---
status: pending
priority: high
source: inventory app (docker-compose.yml, docker-compose.dev.yml, docker/Dockerfile.server)
---

# Docker Architecture: Dev on Host, Prod in Docker, External DB Option

Restructure the Docker setup so development is fast (app on host, only
DB in Docker) and production is flexible (everything in Docker, with the
option to use an external database).

## Development Mode

**Pattern:** App servers run on the host machine. Only PostgreSQL runs
in Docker. This gives fast hot-reload without Docker build overhead.

### docker-compose.dev.yml

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: app
    ports:
      - "${DB_PORT:-5433}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

Port 5433 (not 5432) avoids conflicts with any locally installed PostgreSQL.

### Dev npm scripts

```json
{
  "dev": "concurrently \"npm:dev:db\" \"npm:dev:server\" \"npm:dev:client\"",
  "dev:db": "docker compose -f docker-compose.dev.yml up",
  "dev:server": "npx ts-node-dev --respawn server/src/index.ts",
  "dev:client": "cd client && npx vite"
}
```

### Dev DATABASE_URL

```
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

## Production Mode

**Pattern:** Everything in Docker via Swarm. The app server is a
multi-stage build that includes both the compiled server and built
client assets. PostgreSQL is either a Swarm service or an external
managed database.

### docker-compose.yml (Production Swarm Stack)

```yaml
services:
  server:
    image: ghcr.io/${GITHUB_ORG}/${APP_NAME}-server:${TAG}
    ports:
      - "3000:3000"
    secrets:
      - database_url
      - session_secret
      - admin_password
      - mcp_default_token
      - google_client_id
      - google_client_secret
      - github_client_id
      - github_client_secret
    environment:
      - NODE_ENV=production
      - PORT=3000
      - APP_DOMAIN=${APP_DOMAIN}
    networks:
      - default
      - caddy
    deploy:
      labels:
        caddy: ${APP_DOMAIN}
        caddy.reverse_proxy: "{{upstreams 3000}}"

  # Include this service for self-hosted DB deployments.
  # Remove it and use an external DATABASE_URL for managed DB.
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
      POSTGRES_DB: app
    secrets:
      - db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - default

secrets:
  database_url:
    external: true
  session_secret:
    external: true
  # ... etc

networks:
  caddy:
    external: true

volumes:
  pgdata:
```

### External Database Option

For production deployments where the database should persist independently
of the Docker stack (the inventory app's approach), remove the `db`
service from docker-compose.yml and set `database_url` to point at the
external PostgreSQL instance. Document this clearly:

```
# For self-hosted DB (default):
# DATABASE_URL=postgresql://app:password@db:5432/app

# For external/managed DB:
# DATABASE_URL=postgresql://user:pass@your-db-host:5432/dbname
```

### Multi-Stage Dockerfile

```dockerfile
# Stage 1: Build client
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build server
FROM node:20-alpine AS server-builder
WORKDIR /app
COPY package*.json ./
COPY server/package*.json server/
RUN cd server && npm ci
COPY server/ server/
COPY server/prisma server/prisma
RUN cd server && npx prisma generate && npx tsc

# Stage 3: Production image
FROM node:20-alpine
RUN apk add --no-cache postgresql16-client
WORKDIR /app
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/node_modules ./node_modules
COPY --from=server-builder /app/server/prisma ./prisma
COPY --from=client-builder /app/client/dist ./public
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

Note `postgresql16-client` in the final stage — required for the backup
service's `pg_dump` and `pg_restore`.

### Entrypoint Script

```bash
#!/bin/sh
# Load Docker Swarm secrets as environment variables
for secret_file in /run/secrets/*; do
  if [ -f "$secret_file" ]; then
    secret_name=$(basename "$secret_file" | tr '[:lower:]' '[:upper:]')
    export "$secret_name"="$(cat "$secret_file")"
  fi
done
exec "$@"
```

## Reference Files

- Inventory: `docker-compose.yml` (production Swarm stack)
- Inventory: `docker-compose.dev.yml` (dev DB only)
- Inventory: `docker/Dockerfile.server` (multi-stage build)
- Inventory: `docker/entrypoint.sh` (secrets loading)

## Verification

- `npm run dev` starts DB in Docker, server and client on host
- Hot-reload works for both server and client code changes
- `docker build` produces a working production image
- Production image serves both API and client assets
- Swarm secrets are correctly loaded as environment variables
- App works with both self-hosted and external PostgreSQL
