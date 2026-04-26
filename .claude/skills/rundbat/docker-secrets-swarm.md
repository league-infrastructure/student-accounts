# docker-secrets-swarm

Native runtime secrets for Docker Swarm services. Secrets are stored
encrypted in the Raft log, mounted as files inside task containers, and
only granted to services that explicitly request them.

## When to use

- Deploying to a Swarm cluster (`docker stack deploy`, `docker service create`)
- A rundbat deployment where `swarm: true` or the Docker context points
  at a Swarm manager
- Runtime credentials: DB passwords, API tokens, TLS certs, SSH keys

If you're doing `docker compose up` on a single VPS, see
`docker-secrets-compose` instead — Compose-mode secrets have different
semantics even if the YAML looks similar.

## How rundbat manages Swarm secrets

rundbat treats Swarm secrets as a first-class concern. You declare
them once in `rundbat.yaml` and rundbat handles creation, attachment,
versioning, and rotation through the `rundbat secrets` command. You
do not hand-edit the generated compose file, and you do not run
`docker secret create` directly.

The pieces:

1. **Declare** the secrets in `rundbat.yaml` under
   `deployments.<env>.secrets:`.
2. **Generate** the compose file with `rundbat generate`. The
   `secrets:` block, per-service attachments, and `*_FILE` env vars
   are emitted automatically.
3. **Materialize** the secrets on the swarm manager with
   `rundbat secrets <env>`. Plaintext is decrypted from dotconfig
   and piped into `docker secret create` on stdin — it never lands
   on disk.
4. **Deploy** with `rundbat up <env>` (which runs
   `docker stack deploy`).
5. **Rotate** with `rundbat secrets <env> --rotate <target>`.

## 1. Declare secrets

In `rundbat.yaml` (canonical, per-target form):

```yaml
deployments:
  prod:
    docker_context: swarm-worker      # where tasks run
    manager: swarm-manager            # where secrets live (optional)
    swarm: true
    deploy_mode: stack
    image: myapp:prod
    secrets:
      api_token:
        from_env: LEAGUESYNC_API_TOKEN
        services: [api]
      meetup_client_id:
        from_env: MEETUP_CLIENT_ID
        services: [cron]
      meetup_private_key:
        from_file: stu1884.pem        # dotconfig --file source
        services: [cron]
```

Each entry has:

- **target name** (map key) — the stable logical name. The app
  reads `/run/secrets/<target>` regardless of which version is
  currently attached.
- **`from_env`** — pull the value from a dotconfig env var. The
  generator emits a matching `<KEY>_FILE` env var on each consuming
  service so apps can use the standard `*_FILE` Docker pattern.
- **`from_file`** — pull the value from a dotconfig
  SOPS-encrypted file (PEM, TLS bundle, JSON service-account
  blob). No `*_FILE` env var is auto-emitted; if your app needs
  the path, set the env var yourself in the compose file or
  `public.env`.
- **`services`** — which compose services attach the secret.
  Enforces "don't share one credential across unrelated services".

### Back-compat — flat list shorthand

The pre-sprint-010 flat list still works:

```yaml
deployments:
  prod:
    secrets:
      - POSTGRES_PASSWORD
      - SESSION_SECRET
```

Each entry expands to
`{KEY: {from_env: KEY, services: [app]}}`. Existing projects
keep working without edit.

### `manager:` vs `docker_context:`

- **`docker_context`** — where tasks run. Used by `rundbat up`,
  `down`, `restart`, `logs`.
- **`manager`** (optional) — where secrets are stored and managed.
  Used by `rundbat secret create` and `rundbat secrets`.
- When `manager:` is omitted it defaults to `docker_context`.

This split matters when the swarm manager (control plane) and a
worker context are different docker contexts.

## 2. Generate the compose file

`rundbat generate` produces a Swarm-ready
`docker/docker-compose.<env>.yml` with:

```yaml
# Deploy with: docker stack deploy -c docker/docker-compose.prod.yml myapp_prod
services:
  api:
    image: myapp:prod
    environment:
      LEAGUESYNC_API_TOKEN_FILE: /run/secrets/api_token
    secrets:
      - source: myapp_api_token
        target: api_token
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      update_config:
        order: start-first

  cron:
    image: myapp:prod
    environment:
      MEETUP_CLIENT_ID_FILE: /run/secrets/meetup_client_id
    secrets:
      - source: myapp_meetup_client_id
        target: meetup_client_id
      - source: myapp_meetup_private_key
        target: meetup_private_key
    # ...

secrets:
  myapp_api_token:
    external: true
  myapp_meetup_client_id:
    external: true
  myapp_meetup_private_key:
    external: true
```

The two-level naming is on purpose:

- **`source:`** — the versioned external name on the manager.
  Operators see this; it changes on every rotation.
- **`target:`** — the stable logical name the app reads. The app
  always opens `/run/secrets/<target>` regardless of version.

Don't collapse them — that forces app changes on every rotation.

## 3. Materialize secrets on the manager

`rundbat secrets <env>` is the plural batch command for
managing declared secrets:

```bash
rundbat secrets prod                    # create all missing (idempotent)
rundbat secrets prod --list             # report present-vs-missing
rundbat secrets prod --dry-run          # show docker calls (stdin redacted)
rundbat secrets prod --rotate api_token # rotate one secret end-to-end
```

The default action walks every declared secret, computes its
versioned external name (`<app>_<target>_v<YYYYMMDD>`), and
creates it on the manager if a secret with that exact name does
not already exist. Running it twice is a no-op the second time.

For one-off creates of a single secret, the singular command is
still available:

```bash
# Env-backed
rundbat secret create prod POSTGRES_PASSWORD

# File-backed
rundbat secret create prod --from-file stu1884.pem \
                            --target-name meetup_private_key
```

Both commands target the deployment's `manager` context (or
`docker_context` if `manager:` is unset). Plaintext is piped via
stdin — never argv, never an intermediate file.

## 4. Deploy

```bash
rundbat up prod
```

This runs `docker stack deploy -c docker/docker-compose.prod.yml
<stack>` against `docker_context`. The stack picks up the
`external: true` secret references; if any are missing, the
deploy fails fast with `"secret not found"`.

## 5. Rotate

A Docker secret is immutable. Rotation is always *create-new →
update-service → wait → remove-old*. rundbat does this in one
command:

```bash
rundbat secrets prod --rotate api_token
```

The sequence:

1. Create a new versioned secret with today's date suffix.
2. For each service in the target's `services:` list, run
   `docker service update --secret-rm <old> --secret-add
   source=<new>,target=api_token`.
3. Poll `docker service ps` until every consuming service's
   tasks reach Running on the new spec, with a 90s timeout.
4. Remove the old versioned secret.

If step 2 or 3 fails, rundbat leaves the new secret in place,
keeps the old secret intact, and exits non-zero with a clear
error naming both versions so an operator can finish the cleanup
manually.

For credentials the backing system also knows (a DB password, an
API token), enable the new credential in the backing service
*before* you run `--rotate` — rundbat does not coordinate the
backend update for you.

## Preflight in the container

Fail fast on a missing secret. Do this in the entrypoint, before
the service binds a port:

```bash
test -s /run/secrets/api_token || {
  echo "missing required secret: api_token" >&2
  exit 1
}
```

For several required secrets:

```bash
for secret in api_token meetup_client_id meetup_private_key; do
  test -s "/run/secrets/$secret" || {
    echo "missing required secret: $secret" >&2
    exit 1
  }
done
```

## What you don't do

The pre-sprint-010 workflow asked you to hand-edit compose files
and write your own `make-secrets.sh` scripts. Don't.

- Don't add `secrets:` blocks to a generated compose file by hand.
  Declare them in `rundbat.yaml` and re-generate.
- Don't write a wrapper script that calls `docker secret create`
  in a loop. Use `rundbat secrets <env>`.
- Don't manually bump a `name:` override on the external secret
  entry to swap versions. Use `rundbat secrets --rotate`.
- Don't write `*_FILE` env vars by hand for env-backed secrets.
  The generator emits them automatically.

## References

- https://docs.docker.com/engine/swarm/secrets/
- https://docs.docker.com/engine/swarm/raft/ (why Swarm secrets are
  durable across manager reboots)
