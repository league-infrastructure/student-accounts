# deploy-init

Guided deployment initialization — walks users through all configuration
decisions and writes a complete deployment entry to `rundbat.yaml`.

## When to use

- "I want to deploy"
- "Set up deployment"
- "Configure a deployment"
- "Deploy my application"

## Prerequisites

- `rundbat.yaml` exists (`rundbat init` first)
- `docker/` directory exists (`rundbat generate` first) — or offer to run it

## Steps

### Step 1: Deployment Target

AskUserQuestion:
  question: "What deployment target are you setting up?"
  header: "Target"
  options:
    - label: "dev"
      description: "Local dev server. Your app runs outside Docker (hot reload). Database and other services run in local Docker if needed."
    - label: "local"
      description: "Production image on local Docker. Same container you'd ship, running on your machine. Good for testing the built image."
    - label: "test"
      description: "Remote server for QA/integration testing. Pre-production environment."
    - label: "prod"
      description: "Production. Remote server with real traffic and a real domain name."

After answer:
- If `dev` or `local`: set `docker_context: default`, `build_strategy: context`. Skip Steps 4–6.
- If `test` or `prod`: continue with SSH setup.
- If user types a custom name: ask whether it's local or remote.

### Step 2: Services

AskUserQuestion:
  question: "What services does this deployment need?"
  header: "Services"
  options:
    - label: "PostgreSQL"
      description: "PostgreSQL database running in Docker alongside your app."
    - label: "MariaDB"
      description: "MariaDB database running in Docker alongside your app."
    - label: "Redis"
      description: "Redis cache/queue running in Docker alongside your app."
    - label: "App only"
      description: "No additional services. Using SQLite, a managed database, or no database at all."

After answer:
- Build the `services` list for this deployment.
- If only "App only" selected: services = `[app]`
- Otherwise: services = `[app, postgres, redis, ...]` based on selections

### Step 3: Deploy Mode

Only ask this if services = `[app]` (single container). Otherwise, compose
is required — tell the user:
> "Multiple services selected — using docker compose (required for multi-container deployments)."

AskUserQuestion:
  question: "How should the container be run on the target?"
  header: "Deploy mode"
  options:
    - label: "docker compose (Recommended)"
      description: "Compose file documents all config — ports, labels, env, restart policy — in one readable file."
    - label: "docker run"
      description: "Single docker run command stored in rundbat.yaml. Simpler but less self-documenting."

### Step 4: Remote Access (remote targets only)

Skip for `dev` and `local`.

AskUserQuestion:
  question: "What's the SSH URL for the remote Docker host?"
  header: "SSH host"
  options:
    - label: "I have the URL"
      description: "e.g., ssh://root@docker1.example.com — I'll enter it next."
    - label: "I need to set up SSH first"
      description: "Guide me through generating a deploy key and configuring access."

If "I have the URL": ask for the URL, then run:
```bash
rundbat deploy-init <name> --host <url>
```

If "I need to set up SSH": walk through key generation:
```bash
ssh-keygen -t ed25519 -f config/<name>/<app>-deploy-key -N ""
ssh-copy-id -i config/<name>/<app>-deploy-key.pub user@host
ssh -i config/<name>/<app>-deploy-key user@host docker info
```

### Step 5: Domain Name (remote targets only)

AskUserQuestion:
  question: "What hostname will this deployment use?"
  header: "Hostname"
  options:
    - label: "I have a domain"
      description: "I'll enter the hostname — Caddy labels will be added."
    - label: "No domain yet"
      description: "Skip for now. Add a hostname later in rundbat.yaml."

### Step 6: Build Strategy (remote targets only)

AskUserQuestion:
  question: "How should the Docker image be built?"
  header: "Build"
  options:
    - label: "Build on remote"
      description: "Docker builds directly on the remote server. Fast when architectures match."
    - label: "Build locally, transfer"
      description: "Build on your machine, send via SSH. Use when remote has different CPU architecture."
    - label: "GitHub Actions → GHCR"
      description: "GitHub builds the image and pushes to GHCR. The remote pulls it."

### Step 6b: Swarm probe (remote targets only)

After `rundbat deploy-init <name> --host <url>` runs (in the CLI) it
automatically probes the remote context for Docker Swarm. If Swarm
is active, the user is asked:

> `Swarm detected on <host> (role: manager|worker).`
> `Enable stack mode (swarm: true, deploy_mode: stack)? [Y/n]`

- **Accept**: the CLI writes `swarm: true` and `deploy_mode: stack`
  into the new deployment entry; `rundbat up/down/restart/logs` will
  shell out to `docker stack deploy` / `docker stack rm` /
  `docker service logs`.
- **Decline**: no swarm fields are written; the deployment stays in
  compose mode. The user can opt in later with `rundbat probe <name>`
  + editing `deploy_mode` by hand.
- **Not detected**: no prompt appears; proceed with defaults.
- **Probe unreachable**: a warning is printed and defaults are used.

### Step 6c: Image tag (stack-mode with build-on-host strategy)

When the user accepts the Swarm opt-in AND `build_strategy` is
`context` or `ssh-transfer`, the CLI prompts for an image tag:

> `Image tag for this stack deployment (Swarm pulls this tag — it must
> match what your build produces): [<app_name>:<deployment>]`

- Press enter to accept the default `<app_name>:<deployment>`.
- Enter a custom tag (e.g. `myapp:v1.2.3`) to pin a specific version.
- In `--json` mode the default is auto-filled.

The tag is saved as `deployments.<name>.image` and ends up in the
generated compose's `services.app.image:` field. `rundbat build` tags
the built image with this value so `rundbat up` / `docker stack
deploy` can pull it on the swarm nodes.

`build_strategy: github-actions` is exempt — it has its own
registry image default (`ghcr.io/owner/<app>:latest`).

See the `docker-swarm-deploy` skill for when to prefer Swarm.

### Step 7: Environment Configuration

AskUserQuestion:
  question: "How should environment variables and secrets be managed?"
  header: "Env config"
  options:
    - label: "dotconfig (Recommended)"
      description: "Encrypted secrets via SOPS/age, managed by dotconfig."
    - label: "Manual .env file"
      description: "You manage .env files yourself."
    - label: "None"
      description: "No environment configuration needed."

### Step 8: Summary and Generate

Present the full configuration as a summary table. Then:

1. Run `rundbat deploy-init <name> --host <url> --strategy <strat> --deploy-mode <mode>`
2. Run `rundbat generate`
3. If github-actions: note the required GitHub secrets
4. Run `rundbat deploy <name> --dry-run` to verify

## After setup

- `rundbat up <name>` — start the deployment
- `rundbat down <name>` — stop it
- `rundbat logs <name>` — tail logs
- `rundbat build <name>` — trigger a build
