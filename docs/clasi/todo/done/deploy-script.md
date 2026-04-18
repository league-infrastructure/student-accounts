---
status: pending
priority: medium
source: inventory app (scripts/deploy.sh)
---

# Deploy Script with Pre-Flight Checks

Add a deployment script that validates everything before building and
pushing. Prevents deploying from dirty trees, wrong branches, or
untagged commits.

## Pre-Flight Checks

The script should verify all of these before doing any work:

1. **Clean working tree** — `git status --porcelain` returns empty
2. **Correct branch** — must be on `master` or `main`
3. **APP_DOMAIN set** — production domain is configured
4. **Version tag on HEAD** — `git describe --tags --exact-match HEAD`
   succeeds
5. **Docker available** — `docker info` succeeds
6. **Logged into registry** — `docker pull` from GHCR works (or skip
   with a flag)

If any check fails, print a clear error message and exit non-zero.

## Script

Create `scripts/deploy.sh`:

```bash
#!/bin/bash
set -euo pipefail

# --- Pre-flight ---
echo "=== Pre-flight checks ==="

# Clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is not clean. Commit or stash changes."
  exit 1
fi

# Correct branch
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "master" && "$BRANCH" != "main" ]]; then
  echo "ERROR: Must deploy from master or main (currently on $BRANCH)"
  exit 1
fi

# Version tag
VERSION=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
if [ -z "$VERSION" ]; then
  echo "ERROR: HEAD is not tagged. Run 'npm run version:tag' first."
  exit 1
fi
VERSION="${VERSION#v}" # strip leading v

# Required env
: "${APP_DOMAIN:?ERROR: APP_DOMAIN is not set}"
: "${GITHUB_ORG:?ERROR: GITHUB_ORG is not set}"
: "${APP_NAME:?ERROR: APP_NAME is not set}"

IMAGE="ghcr.io/${GITHUB_ORG}/${APP_NAME}-server:${VERSION}"

echo "Deploying $IMAGE to $APP_DOMAIN"

# --- Build ---
echo "=== Building Docker image ==="
docker build \
  -f docker/Dockerfile.server \
  --build-arg APP_VERSION="$VERSION" \
  -t "$IMAGE" .

# --- Push ---
echo "=== Pushing to registry ==="
docker push "$IMAGE"

# --- Deploy ---
echo "=== Deploying to Swarm ==="
TAG="$VERSION" docker stack deploy \
  -c docker-compose.yml \
  "$APP_NAME"

# --- Migrate ---
echo "=== Running migrations ==="
docker service create \
  --name "${APP_NAME}-migrate" \
  --restart-condition none \
  --network "${APP_NAME}_default" \
  --secret database_url \
  --entrypoint sh \
  "$IMAGE" \
  -c 'export DATABASE_URL=$(cat /run/secrets/database_url) && npx prisma migrate deploy'

# Wait for migration
echo "Waiting for migration to complete..."
while docker service ps "${APP_NAME}-migrate" --format '{{.CurrentState}}' | grep -q Running; do
  sleep 2
done

# Cleanup migration service
docker service rm "${APP_NAME}-migrate" 2>/dev/null || true

echo "=== Deploy complete: $VERSION ==="
```

## npm Scripts

```json
{
  "deploy": "scripts/deploy.sh",
  "deploy:build": "docker build -f docker/Dockerfile.server -t app .",
  "deploy:migrate": "npx prisma migrate deploy"
}
```

## Reference Files

- Inventory: `scripts/deploy.sh`

## Verification

- Deploying from a dirty working tree fails with clear error
- Deploying from a non-main branch fails
- Deploying without a version tag fails
- Successful deploy builds, pushes, deploys stack, and runs migrations
- Migration service cleans itself up after completion
