# deploy-setup

Set up a deployment target with the right build strategy. Walks through
SSH access, platform detection, and strategy-specific configuration.

## When to use

- "I want to deploy this app"
- "Set up deployment to my server"
- "Deploy to production"
- "Configure remote deployment"

## Prerequisites

- Project initialized (`rundbat.yaml` exists — run `rundbat init` first)
- Docker artifacts generated (`docker/` exists — run `rundbat init-docker` first)

## Steps

### 1. Determine deployment target

Ask the user: Where are you deploying?

- **Local Docker (dev/test)** → The default `context` strategy with
  the local Docker context is sufficient. No further setup needed.
- **A remote server via SSH** → Continue to step 2.

### 2. Verify SSH access

Ask: Do you have SSH key access to the remote host?

If **no**, guide them through setup:

```bash
# Generate a deploy key
ssh-keygen -t ed25519 -f config/prod/<app>-deploy-key -N ""

# Copy public key to remote host
ssh-copy-id -i config/prod/<app>-deploy-key.pub user@host

# Store key path as a secret
rundbat set-secret prod SSH_KEY_PATH=config/prod/<app>-deploy-key

# Test access
ssh -i config/prod/<app>-deploy-key user@host docker info
```

If **yes**, verify it works: `ssh user@host docker info`

### 3. Initialize the deployment target

```bash
rundbat deploy-init prod --host ssh://user@host
```

This will:
- Create a Docker context for the remote host
- Verify Docker access on the remote
- Auto-detect the remote platform (e.g., `linux/amd64`)
- Save host, platform, and build strategy to `rundbat.yaml`

If the remote platform differs from local (e.g., local is `arm64`,
remote is `amd64`), rundbat automatically selects `ssh-transfer`.

### 4. Choose a build strategy

Ask the user which strategy to use:

| Strategy | When to use |
|----------|-------------|
| `context` | Remote has enough resources to build. Same architecture. |
| `ssh-transfer` | Remote is small or different architecture. Build locally, send via SSH. |
| `github-actions` | Want CI/CD. GitHub builds and pushes to GHCR, remote pulls. |

Override the auto-selected strategy if needed:

```bash
rundbat deploy-init prod --host ssh://user@host --strategy github-actions
```

### 5. Strategy-specific setup

#### context (default)

No extra configuration needed. After deploy, rundbat automatically
cleans up dangling images on the remote.

#### ssh-transfer

Verify Docker buildx is available (required for cross-platform builds):

```bash
docker buildx version
```

If not installed, Docker Desktop (Mac) includes it. On Linux, install
the buildx plugin.

#### github-actions

1. Verify the project has a GitHub remote:
   ```bash
   git remote get-url origin
   ```

2. Generate the deploy workflow:
   ```bash
   # rundbat generates .github/workflows/deploy.yml
   ```
   Review the generated workflow file.

3. Add GitHub repository secrets (Settings → Secrets and variables → Actions):
   - `DEPLOY_SSH_KEY` — paste the contents of the deploy private key
   - `DEPLOY_HOST` — the remote hostname (e.g., `docker1.example.com`)
   - `DEPLOY_USER` — the SSH user (e.g., `root`)

4. **Public repos**: GHCR images are public — remote pulls without login.
   Add this label to the Dockerfile to link the package to the repo:
   ```dockerfile
   LABEL org.opencontainers.image.source=https://github.com/OWNER/REPO
   ```

5. **Private repos**: The remote needs GHCR pull access.
   - Create a GitHub PAT with `read:packages` scope
   - On the remote, run:
     ```bash
     echo "TOKEN" | docker login ghcr.io --username USERNAME --password-stdin
     ```
   - Or store the token and automate login in the workflow

### 6. Test

```bash
rundbat deploy prod --dry-run
```

This prints the full command pipeline without executing.

### 7. Deploy

```bash
rundbat deploy prod
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `docker buildx` not found | Install Docker Desktop (Mac) or buildx plugin (Linux) |
| SSH connection refused | Check SSH key, host, and port. Run `ssh -v user@host` |
| GHCR pull unauthorized | Repo is private — set up PAT and `docker login ghcr.io` on remote |
| Image wrong architecture | Check `platform` in `rundbat.yaml` matches remote. Use `--platform` flag |
| Transfer timeout | Large images — increase timeout or switch to `github-actions` strategy |
