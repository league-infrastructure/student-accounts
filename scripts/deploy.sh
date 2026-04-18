#!/bin/bash
# Production deployment script with pre-flight checks.
# Builds Docker image, pushes to registry, deploys to Swarm, runs migrations.

set -euo pipefail

# Load environment
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

echo "=== Pre-flight checks ==="

# 1. Clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is not clean. Commit or stash changes."
  exit 1
fi
echo "  ✓ Working tree is clean"

# 2. Correct branch
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "master" && "$BRANCH" != "main" ]]; then
  echo "ERROR: Must deploy from master or main (currently on $BRANCH)"
  exit 1
fi
echo "  ✓ On branch $BRANCH"

# 3. Version tag on HEAD
VERSION=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
if [ -z "$VERSION" ]; then
  echo "ERROR: HEAD is not tagged. Run 'npm run version:tag' first."
  exit 1
fi
VERSION="${VERSION#v}" # strip leading v
echo "  ✓ Version: $VERSION"

# 4. Required environment variables
: "${APP_DOMAIN:?ERROR: APP_DOMAIN is not set}"
: "${GITHUB_ORG:?ERROR: GITHUB_ORG is not set}"
: "${APP_NAME:?ERROR: APP_NAME is not set}"
echo "  ✓ APP_DOMAIN=$APP_DOMAIN"

# 5. Docker available
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not available. Is the daemon running?"
  exit 1
fi
echo "  ✓ Docker is available"

# 6. Docker context
DOCKER_CONTEXT="${PROD_DOCKER_CONTEXT:-default}"

IMAGE="ghcr.io/${GITHUB_ORG}/${APP_NAME}-server:${VERSION}"

echo ""
echo "=== Deploying $IMAGE to $APP_DOMAIN ==="

# --- Build ---
echo ""
echo "=== Building Docker image ==="
docker build \
  -f docker/Dockerfile.server \
  --build-arg APP_VERSION="$VERSION" \
  -t "$IMAGE" .

# --- Push ---
echo ""
echo "=== Pushing to registry ==="
docker push "$IMAGE"

# --- Deploy ---
echo ""
echo "=== Deploying to Swarm ==="
REGISTRY="ghcr.io/${GITHUB_ORG}" TAG="$VERSION" \
  DOCKER_CONTEXT="$DOCKER_CONTEXT" \
  docker stack deploy -c docker-compose.yml "$APP_NAME"

# --- Migrate ---
echo ""
echo "=== Running migrations ==="
DOCKER_CONTEXT="$DOCKER_CONTEXT" \
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
while DOCKER_CONTEXT="$DOCKER_CONTEXT" docker service ps "${APP_NAME}-migrate" --format '{{.CurrentState}}' 2>/dev/null | grep -q Running; do
  sleep 2
done

# Cleanup migration service
DOCKER_CONTEXT="$DOCKER_CONTEXT" docker service rm "${APP_NAME}-migrate" 2>/dev/null || true

echo ""
echo "=== Deploy complete: $VERSION ==="
