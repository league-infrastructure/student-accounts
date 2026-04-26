# docker-best-practices

A checklist mapped to [Docker's Build Best Practices guide](https://docs.docker.com/build/building/best-practices/), annotated with what rundbat's generated Dockerfiles already do so you can quickly grade a Dockerfile or triage a review.

## When to use

- "Is this Dockerfile OK?"
- "What should a production Dockerfile look like?"
- Reviewing a hand-written Dockerfile against Docker's recommendations
- Deciding whether to re-run `rundbat generate` to pick up template improvements

If you're looking for **secrets** (Swarm secrets, Compose `secrets:`, BuildKit `--secret`), that's a separate concern — see `docker-secrets`.

## Checklist

### Layers & caching

- [x] **Order by frequency of change.** Base image → system deps → app deps → app code. *rundbat: all templates copy `package*.json` / `requirements*.txt` before `COPY . .`.*
- [x] **BuildKit cache mounts** for package managers. *rundbat: `RUN --mount=type=cache,target=/root/.npm npm ci` and `RUN --mount=type=cache,target=/root/.cache/pip pip install …`. Requires `# syntax=docker/dockerfile:1` at top — rundbat emits it.*
- [ ] **Combine related `RUN` commands.** Group `apt-get update && apt-get install && rm -rf /var/lib/apt/lists/*` in a single `RUN` when you need system packages. *Not needed in rundbat's current Alpine/slim templates — add when you introduce apt packages.*

### Image size

- [x] **Minimal base images.** `node:20-alpine`, `python:3.12-slim`, `nginxinc/nginx-unprivileged:alpine`. *rundbat defaults to these.*
- [x] **Multi-stage builds.** Keep build tools out of the runtime image. *rundbat: Node is 2-stage, Astro is 3-stage, Python is 2-stage with a `/opt/venv` copy.*
- [x] **`.dockerignore`** to exclude `.git`, `node_modules`, tests, docs, `.env*`, AI-assistant files. *rundbat: see `.dockerignore` emitted by `generate_dockerignore()`.*

### Security

- [x] **Run as non-root `USER`.** *rundbat: `USER node` (Node templates), `USER appuser` (Python templates, UID 1000), nginx-unprivileged image (Astro).*
- [x] **`COPY --chown=…`** so files in the runtime stage are owned by the runtime user. *rundbat emits this on every runtime-stage `COPY` in Node and Python templates.*
- [ ] **Pin base image digests** (`FROM image:tag@sha256:…`) for supply-chain integrity. *Not default in rundbat — opt in if your risk model requires it and you have a bump workflow.*
- [ ] **Rebuild regularly** to pick up base-image security patches. *Schedule a weekly build (e.g., GitHub Actions `schedule:` trigger on the generated `build.yml`).*

### Multi-stage specifics

- [x] **Name every stage.** `AS builder`, `AS deps`, `AS build`. *rundbat does this — no `COPY --from=0`.*
- [x] **Only copy runtime artifacts** into the final stage. *rundbat: Next copies `.next`, `node_modules`, `package.json`; Python copies `/opt/venv` and app code; Astro copies only `dist`.*
- [ ] **`docker build --target <stage>`** to build intermediate stages for debugging. *Works out of the box given named stages.*

### Signal handling & entrypoints

- [x] **Exec-form `CMD`** for proper PID-1 signal handling. *rundbat: all templates use `CMD ["prog", "arg", …]`.*
- [x] **Entrypoint script `exec "$@"`.** *rundbat: see `generate_entrypoint()`.*

### File operations

- [x] **`COPY`, not `ADD`** except for auto-extracting tarballs or validated URL fetches. *rundbat: never uses `ADD`.*
- [x] **Absolute `WORKDIR`.** *rundbat: `WORKDIR /app`.*

### Observability

- [x] **`HEALTHCHECK`** in the app Dockerfile. *rundbat: Node uses `node -e "http.get(…)"`, Python uses `python -c "urllib.request.urlopen(…)"`, Astro uses `wget --spider`. All require the app to respond on `/` with a status < 500. Override or remove if your app doesn't serve `/`.*
- [x] **Compose-level healthchecks** for DB services. *rundbat: `pg_isready`, `healthcheck.sh --connect`, `redis-cli ping`.*
- [x] **`EXPOSE`** to document listening ports. *rundbat: `EXPOSE ${PORT:-3000}` / `8000` / `8080`.*

### Environment & versioning

- [x] **`ENV NODE_ENV=production`** in Node runtime. *rundbat emits this.*
- [ ] **`ARG` for build-time, `ENV` for runtime.** Don't promote `ARG` values into `ENV` if they contain secrets. *See `docker-secrets-build` for the right way to pass build-time credentials — BuildKit `--mount=type=secret`, never `ARG TOKEN=`.*

### Metadata (optional)

- [ ] **OCI `LABEL`** (`org.opencontainers.image.source`, `.title`, `.revision`). *Not emitted by rundbat's templates; `github-deploy.md` covers adding the `.source` label when pushing to GHCR.*

## When the checklist surfaces a gap

If `rundbat generate` produced a template that doesn't meet a checked item above, rundbat has drifted from its own docs — flag it. If you need a non-default behavior (different USER, different HEALTHCHECK path, digest pinning), hand-edit the generated `docker/Dockerfile`; `rundbat generate` won't clobber it without `--force`.

## References

- Docker Build Best Practices: https://docs.docker.com/build/building/best-practices/
- BuildKit cache mounts: https://docs.docker.com/build/cache/optimize/
- Multi-stage builds: https://docs.docker.com/build/building/multi-stage/
