# github-deploy

Deploy via GitHub Actions — build images on GitHub, push to GHCR,
deploy to remote Docker host.

## When to use

- "Deploy via GitHub Actions"
- "Set up CI/CD"
- "Use GHCR for deployment"
- "GitHub Actions deploy"

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth login`)
- Project has a GitHub remote (`git remote get-url origin`)
- Deployment target configured (`rundbat deploy-init`)
- Docker artifacts generated (`rundbat generate`)

## Steps

### 1. Initialize deployment with github-actions strategy

```bash
rundbat deploy-init prod --host ssh://root@host --strategy github-actions
```

If using docker run mode (single container, no compose):
```bash
rundbat deploy-init prod --host ssh://root@host --strategy github-actions --deploy-mode run --image ghcr.io/owner/repo
```

### 2. Generate artifacts

```bash
rundbat generate
```

This creates:
- `.github/workflows/build.yml` — builds image and pushes to GHCR
- `.github/workflows/deploy.yml` — SSHes to remote and restarts
- `docker/docker-compose.prod.yml` — compose file for the deployment

### 3. Configure GitHub secrets

Go to the repository Settings → Secrets and variables → Actions and add:

| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | Remote hostname (e.g., `docker1.example.com`) |
| `DEPLOY_USER` | SSH user (e.g., `root`) |
| `DEPLOY_SSH_KEY` | Paste contents of the deploy private key |

### 4. Commit and push

```bash
git add .github/workflows/
git commit -m "Add CI/CD workflows"
git push
```

The build workflow triggers automatically on push to main.

### 5. Trigger a build manually

```bash
rundbat build prod
```

This calls `gh workflow run build.yml`. Watch progress with:
```bash
gh run watch
```

### 6. Deploy

The deploy workflow runs automatically after a successful build.

To trigger a deploy manually:
```bash
rundbat up prod --workflow
```

Or pull and start directly (fast path, no GitHub round-trip):
```bash
rundbat up prod
```

## Private repositories

For private repos, the remote needs GHCR pull access:

1. Create a GitHub PAT with `read:packages` scope
2. On the remote: `echo "TOKEN" | docker login ghcr.io --username USER --password-stdin`

For public repos, GHCR images pull without auth. Add this label to
the Dockerfile to link the package to the repo:

```dockerfile
LABEL org.opencontainers.image.source=https://github.com/OWNER/REPO
```
