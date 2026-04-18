# dev-database

Set up database services for local development using docker compose.

## When to use

- "I need a dev database"
- "Give me a Postgres/Redis for development"
- "Set up a local database"

## Steps

1. Ensure Docker artifacts exist. If no `docker/docker-compose.yml`:
   ```bash
   rundbat init-docker
   ```

2. Start services:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```

3. Check services are healthy:
   ```bash
   docker compose -f docker/docker-compose.yml ps
   ```

4. Get the connection string from dotconfig:
   ```bash
   dotconfig load -d dev --json --flat -S
   ```
   Look for `DATABASE_URL` in the output.

5. If no `DATABASE_URL` exists yet, store one:
   ```bash
   dotconfig load -d dev --json
   # Edit .env.json to add DATABASE_URL in the secrets section
   dotconfig save --json
   ```

## Adding a database service

If the compose file doesn't include the database you need, edit
`docker/docker-compose.yml` to add a postgres, mariadb, or redis
service with appropriate health checks.
