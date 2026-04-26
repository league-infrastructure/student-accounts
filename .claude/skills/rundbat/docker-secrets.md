# docker-secrets

Pick the right Docker secret mechanism for the deployment target. rundbat
uses **dotconfig** (SOPS/age) as the source of truth; Docker's own secret
mechanisms are how values get *into* containers. These are separate
concerns — dotconfig stores, Docker transports.

## When to use

- "How should I pass `DB_PASSWORD` to the production container?"
- "Do I need Swarm secrets or Compose secrets?"
- "How do I pass a build-time NPM token without baking it into the image?"

## Decision framework

| Deployment target | Use | Skill |
|---|---|---|
| Docker Swarm (any service, any scale) | Swarm secrets (`docker secret create`) | `docker-secrets-swarm` |
| Plain Docker host (single node, `docker compose up`) | File-mounted Compose secrets | `docker-secrets-compose` |
| Build time (npm/pypi/ssh credentials during `docker build`) | BuildKit `--secret` mounts | `docker-secrets-build` |
| Local dev / throwaway envs | `env_file` via dotconfig (rundbat's current default) | `manage-secrets` |

In rundbat's config, `rundbat.yaml` deployments with `swarm: true` or that
target a Swarm manager go down the Swarm path; everything else is "plain
Docker host".

## The env-var gap in rundbat today

rundbat currently injects secrets via `env_file: ["../.env"]` in the
generated `docker-compose.<env>.yml`. The `.env` is checked out from
dotconfig at `rundbat up` time. That's fine for dev and test — values are
encrypted at rest and never committed — but for production it's
sub-optimal: environment-variable values leak through `docker inspect`,
crash reports, child processes, and accidental logs in ways file-mounted
secrets do not.

For production, layer a Compose `secrets:` block or Swarm external
secrets on top. dotconfig stays the source of truth; only the compose
file and the deploy step change. See the sibling skills for the
migration pattern.

## Hard rules

1. **Never bake credentials into images.** No `ENV API_KEY=…`,
   `ARG TOKEN=…`, or `COPY id_rsa …` in Dockerfiles.
2. **Never use `docker run -e SECRET=value`** in production.
3. **Never treat `.gitignore` as security.** An ignored `.env` is a
   convenience, not a boundary.
4. **Prefer `_FILE` env vars** (e.g. `POSTGRES_PASSWORD_FILE`) over raw
   `POSTGRES_PASSWORD`. Postgres, MySQL/MariaDB, Redis, and most official
   images read `*_FILE` natively. The env var contains a path, not a secret.
5. **Don't share one credential across unrelated services.** Web app,
   worker, migration job, and admin tool each get their own.
6. **Don't log secret values.** Redact in startup banners, error
   handlers, and support output. Redaction is interface, not decoration.

## Rotation, briefly

A Docker secret is immutable. Rotation is always *create-new →
update-service → remove-old*. For credentials the backing system also
knows (DB passwords, API tokens), coordinate with the backing system
first — rotate the container secret only after the backend has accepted
the new credential, or you're just producing an outage with a better
name.

## What rundbat generates today (reality check)

- `env_file: ["../.env"]` in every `docker-compose.<env>.yml`
- For Swarm deployments with a `secrets:` block in `rundbat.yaml`:
  per-service `secrets:` attachments, top-level `external: true`
  references, and `*_FILE` env vars on each consuming service —
  see `docker-secrets-swarm` for the declarative interface and the
  `rundbat secrets` command.
- No Compose-mode `secrets:` mounts on plain Docker hosts — see
  `docker-secrets-compose` for that pattern.
- No BuildKit `--mount=type=secret` in generated Dockerfiles — see
  `docker-secrets-build` for build-time credentials.

## References

- Docker Compose secrets: https://docs.docker.com/compose/how-tos/use-secrets/
- Docker Swarm secrets: https://docs.docker.com/engine/swarm/secrets/
- BuildKit build secrets: https://docs.docker.com/build/building/secrets/
- OWASP Docker Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
