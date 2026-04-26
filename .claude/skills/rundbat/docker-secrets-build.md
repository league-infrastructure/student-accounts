# docker-secrets-build

Pass credentials *into* `docker build` without them landing in image
layers, build-cache metadata, or logs. Build-time secrets are a
different concern from runtime secrets — for what the running container
sees, use `docker-secrets-swarm` or `docker-secrets-compose`.

## When to use

- Private npm registry token needed for `npm ci`
- Private PyPI token needed for `pip install`
- SSH key needed to clone a private Git dependency
- Cloud credentials (AWS/GCS/Azure) needed to fetch a model or artifact
  during build

## Dockerfile syntax

Requires BuildKit (default on modern Docker). Add the syntax directive
so `--mount=type=secret` is available:

```dockerfile
# syntax=docker/dockerfile:1

RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" npm ci
```

The secret is mounted as a **tmpfs file** at `/run/secrets/<id>` only for
the duration of that single `RUN` instruction. It does not appear in any
resulting image layer, nor in the build cache metadata.

## CLI forms

```bash
# From a file on the build host
docker build --secret id=aws,src=$HOME/.aws/credentials .

# From an environment variable (id doubles as env name by default)
NPM_TOKEN=... docker build --secret id=NPM_TOKEN .

# Rename env explicitly
docker build --secret id=kube,env=KUBECONFIG .
```

## Useful variants

- **`target=/path`** — mount somewhere other than `/run/secrets/<id>`,
  useful when a tool expects a specific path:
  ```dockerfile
  RUN --mount=type=secret,id=aws,target=/root/.aws/credentials \
      aws s3 cp ...
  ```
- **`env=VAR`** — expose the secret as an environment variable inside
  the `RUN` step (the variable is set only for that command, not
  persisted in any layer):
  ```dockerfile
  RUN --mount=type=secret,id=aws-key,env=AWS_ACCESS_KEY_ID \
      aws s3 cp ...
  ```
  You can combine `target=` and `env=` to get both.
- **`required=true`** — fail the build if the secret is not supplied,
  rather than silently skipping the `RUN`.

## SSH keys use a separate flag

For cloning private Git repos during build, use `--ssh` instead of
`--secret`:

```bash
docker buildx build --ssh default .
```

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=ssh \
    git clone git@github.com:org/private-repo.git
```

This forwards the host's SSH agent socket into the build; the private
key itself never enters the build context.

## What not to do

These patterns leak credentials into the final image, `docker history`,
or build cache:

```dockerfile
# BAD — secret is baked into the image
ENV OPENAI_API_KEY=...

# BAD — ARG values are visible via `docker history`
ARG TOKEN=...
RUN npm install

# BAD — the file is in a layer even if you rm it later
COPY id_rsa /root/.ssh/id_rsa
RUN git clone ... && rm /root/.ssh/id_rsa
```

The general rule: no build credential in a Dockerfile's `ARG`, `ENV`,
or `COPY` instruction, and no secret echoed in `RUN` output (build logs
are archived in CI).

## Rundbat integration

rundbat's generated Dockerfiles don't currently use BuildKit secrets —
most apps don't need them. If you do:

1. **Keep the credential in dotconfig** as the source of truth.
2. **Pass it into the build** via `--secret id=<name>,env=<VAR>`:
   ```bash
   NPM_TOKEN=$(dotconfig get -d prod NPM_TOKEN) \
     docker build --secret id=npm_token -t myapp .
   ```
   For rundbat's GitHub Actions build strategy, add the same step to
   the generated `build.yml` — read the secret from GitHub Actions
   secrets, export it, then pass via `--secret`.
3. **Edit the generated Dockerfile** to add the
   `RUN --mount=type=secret,id=…` line. Keep
   `# syntax=docker/dockerfile:1` at the top (rundbat's future template
   update will add this by default).

## References

- https://docs.docker.com/build/building/secrets/
- https://docs.docker.com/build/ci/github-actions/secrets/ (passing
  secrets from GitHub Actions into BuildKit)
