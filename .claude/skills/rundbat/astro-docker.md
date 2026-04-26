# astro-docker

Deploy an Astro static site with Docker. Generates a multi-stage
Dockerfile (node build → nginx serve) and a production nginx config.

## When to use

- "Deploy an Astro site"
- "Containerize my Astro project"
- "Docker setup for Astro"

## Prerequisites

- Project initialized (`rundbat.yaml` exists — run `rundbat init` first)
- `package.json` lists `astro` as a dependency

## Steps

1. Run the generator:
   ```bash
   rundbat init-docker --json
   ```

   This auto-detects Astro and generates all artifacts including
   `docker/nginx.conf`.

2. Review the generated files in `docker/`:
   - `Dockerfile` — 3-stage build: deps (node), build (astro), runtime (`nginxinc/nginx-unprivileged:alpine`, UID 101)
   - `nginx.conf` — production config with SPA routing, gzip, cache headers
   - `docker-compose.yml` — app service on port 8080
   - `.env.example` — environment variable template

   The Dockerfile also emits a `HEALTHCHECK` that hits `http://localhost:8080/`
   via `wget --spider`. The target is `/` because nginx serves `index.html`
   for SPA fallback, so `/` is reliably 200 for any static Astro build. If
   your site serves from a base path, edit the healthcheck URL.

3. Customize if needed:
   - If your Astro project uses a custom `outDir`, update the
     `COPY --from=build /app/dist` line in the Dockerfile.
   - If you need a custom `server_name`, edit `docker/nginx.conf`.
   - If using a base path, add it to the nginx `location` blocks.

4. If deploying behind Caddy, run the probe first:
   ```bash
   rundbat probe <deployment>
   rundbat init-docker --hostname <your-hostname>
   ```

   This adds Caddy reverse proxy labels to the compose file.

5. Test locally:
   ```bash
   docker compose -f docker/docker-compose.yml up --build
   ```

   Visit http://localhost:8080 to verify.

6. Deploy using the deploy-setup skill.

## Notes

- Port 8080 is used (nginx-unprivileged image runs as UID 101 and listens
  on 8080 by default — no privilege needed).
- Only static output is supported (`output: "static"` in `astro.config.*`).
  SSR/hybrid Astro support is planned for a future sprint.
- The nginx config includes SPA routing fallback (`try_files`),
  1-year cache for hashed assets, and security headers.
- See `docker-best-practices` for the full checklist of what rundbat's
  Astro template does and does not enforce.

## Outputs

```
docker/
  Dockerfile
  nginx.conf
  docker-compose.yml
  .env.example
```
