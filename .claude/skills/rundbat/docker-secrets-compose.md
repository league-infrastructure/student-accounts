# docker-secrets-compose

File-mounted secrets for single-node Docker hosts (no Swarm). Compose
mounts a host file into the container at a stable path. Less magical
than Swarm secrets — the security boundary is host filesystem
permissions plus deploy discipline — but the right choice for most
small-scale production deployments.

## When to use

- Production on a single Docker host, no Swarm cluster
- rundbat deployment with `deploy_mode: compose` or `run`
- You want secret values out of `docker inspect`, container env, and logs

Compose `secrets:` looks like Swarm secrets but **is not the same thing**.
On a non-Swarm host, the source is an ordinary file on disk. Treat host
FS permissions as the actual security boundary.

## Host-side setup

One-time per host. Root-owned, locked-down, one file per secret:

```bash
sudo install -d -m 0700 -o root -g root /etc/<app>/secrets
printf '%s' "$POSTGRES_PASSWORD" | \
  sudo tee /etc/<app>/secrets/postgres_password >/dev/null
sudo chmod 0400 /etc/<app>/secrets/postgres_password
```

Never mount a *directory* of secrets — that exposes everything in it.
Mount individual files.

## Compose service

```yaml
services:
  app:
    image: myorg/app:latest
    secrets:
      - postgres_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password

secrets:
  postgres_password:
    file: /etc/<app>/secrets/postgres_password
```

Inside the container, Compose mounts the file at
`/run/secrets/postgres_password` (the top-level key under `secrets:`
becomes the filename). The application reads from that path — use the
`_FILE` env-var convention so the app never sees the raw value.

## Provisioning the host files

Don't hand-edit except in emergencies. Pick one:

- **SOPS-decrypt during deploy.** Natural fit with rundbat's dotconfig,
  which already uses SOPS/age. Instead of (or in addition to) the flat
  `.env` checkout, write one file per secret to `/etc/<app>/secrets/`.
- **Ansible Vault, 1Password CLI, AWS Secrets Manager, HashiCorp Vault,
  Bitwarden Secrets Manager, Google Secret Manager, Azure Key Vault.**
  All fine — the container doesn't care.

The container's contract is simple: read `/run/secrets/<name>`. The
secret-acquisition layer belongs outside the image.

## Migrating from rundbat's env_file pattern

rundbat currently generates:

```yaml
services:
  app:
    env_file: ["../.env"]
```

where `.env` is written by `rundbat up` from a `dotconfig load -d <env>`
checkout. Every secret flows in as an env var.

To migrate a specific secret to file-mounted (example:
`POSTGRES_PASSWORD`):

1. **Add a deploy-time step** that writes
   `/etc/<app>/secrets/postgres_password` on the target host from
   dotconfig. On a remote context, this looks like:
   ```bash
   ssh deploy@prod-host '
     sudo install -d -m 0700 -o root -g root /etc/<app>/secrets &&
     sudo tee /etc/<app>/secrets/postgres_password >/dev/null &&
     sudo chmod 0400 /etc/<app>/secrets/postgres_password
   ' <<<"$(dotconfig get -d prod POSTGRES_PASSWORD)"
   ```
2. **Edit `docker/docker-compose.<env>.yml`** to add the top-level
   `secrets:` block and attach it to the app service. Keep the
   `env_file:` for the non-secret vars, or remove the secret keys from
   dotconfig if you want a single source.
3. **Change the app** to read `POSTGRES_PASSWORD_FILE` — or if you're
   using an official image (postgres, mysql, mariadb), just switch the
   env var name; those images already handle `*_FILE`.
4. **Verify** with `docker compose config` that the secret is wired
   correctly, then restart.

Expect to maintain the compose edits against `rundbat generate` — they
don't round-trip yet. Either keep the production compose as a managed
overlay (e.g., `docker-compose.prod.override.yml`) or accept hand-edits.

## Preflight in the entrypoint

Fail fast rather than starting half-configured:

```bash
for secret in postgres_password api_token; do
  test -s "/run/secrets/$secret" || {
    echo "missing required secret: $secret" >&2
    exit 1
  }
done
```

## Common pitfalls

- **`docker compose` on plain Docker ≠ Swarm secrets.** Same YAML,
  different semantics. Host FS perms are load-bearing.
- **Mounting a directory exposes all of it.** Mount individual files.
- **One big god-secret across services is wrong.** Web, worker, cron,
  and migration jobs each get distinct credentials unless there's a
  documented reason.
- **`docker exec` inherits env vars.** A file-mounted secret at
  `/run/secrets/foo` does not appear in `docker exec` env dumps;
  a `POSTGRES_PASSWORD` env var does.
- **Backups.** If you back up `/etc/<app>/secrets` at the host level,
  the backup tool needs the same discipline (encrypted at rest,
  restricted access).

## References

- https://docs.docker.com/compose/how-tos/use-secrets/
