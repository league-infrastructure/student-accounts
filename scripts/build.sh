#!/usr/bin/env bash
# build_image.sh — build a multi-arch image and push to GitHub Container Registry.
#
# Pre-condition: IMAGE_TAG should already reflect the version you want to ship.
# Bump the version externally before calling this (e.g. `clasi version bump`).
#
# Auth: only GITHUB_TOKEN is required. The username is derived from the token
# via the GitHub API. If you need a different registry or auth scheme, extend
# this script — keeping it single-source-of-truth here is intentional.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH_LATEST="${PUSH_LATEST:-0}"
BUILDER_NAME="${BUILDER_NAME:-student-accounts-multiarch}"
DRY_RUN=0

derive_registry_username() {
  local login
  login="$({
    curl -fsSL https://api.github.com/user \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
    | python3 -c 'import json, sys; print(json.load(sys.stdin).get("login", ""))'
  } 2>/dev/null || true)"

  if [[ -z "${login}" || "${login}" == "None" ]]; then
    echo "Unable to determine GitHub username from GITHUB_TOKEN. Check the token has 'read:user' scope." >&2
    exit 1
  fi
  echo "${login}"
}

derive_image_repo() {
  local remote_url repo_path
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -z "${remote_url}" ]]; then
    echo "Unable to determine IMAGE_REPO from git origin. Set IMAGE_REPO explicitly." >&2
    exit 1
  fi
  case "${remote_url}" in
    git@github.com:*)         repo_path="${remote_url#git@github.com:}" ;;
    https://github.com/*)     repo_path="${remote_url#https://github.com/}" ;;
    ssh://git@github.com/*)   repo_path="${remote_url#ssh://git@github.com/}" ;;
    *) echo "Unsupported origin remote for GHCR: ${remote_url}" >&2; exit 1 ;;
  esac
  repo_path="${repo_path%.git}"
  repo_path="$(printf '%s' "${repo_path}" | tr '[:upper:]' '[:lower:]')"
  echo "ghcr.io/${repo_path}"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run]

Build and push a multi-arch image to GitHub Container Registry via Docker Buildx.

Environment:
  IMAGE_REPO    Target image repo. Default: derived from git origin (ghcr.io/<owner>/<repo>)
  IMAGE_TAG     Target image tag. Default: current package.json / pyproject version
  PLATFORMS     Build platforms. Default: ${PLATFORMS}
  PUSH_LATEST   Set to 0 to skip the :latest tag. Default: ${PUSH_LATEST}
  BUILDER_NAME  Buildx builder name. Default: ${BUILDER_NAME}
  GITHUB_TOKEN  PAT or workflow token with 'write:packages' (and 'read:user' for username derivation)
EOF
}

ensure_builder() {
  local driver
  if docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
    driver="$(docker buildx inspect "${BUILDER_NAME}" | awk -F': *' '/^Driver:/ { print $2; exit }')"
    if [[ "${driver}" != "docker-container" ]]; then
      echo "Buildx builder ${BUILDER_NAME} uses unsupported driver ${driver}; expected docker-container." >&2
      exit 1
    fi
    return
  fi
  if [[ ${DRY_RUN} -eq 1 ]]; then
    echo "DRY RUN: docker buildx create --name ${BUILDER_NAME} --driver docker-container --use"
    return
  fi
  docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
  docker buildx inspect --bootstrap "${BUILDER_NAME}" >/dev/null
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

cd "${ROOT_DIR}"

# Tag resolution (no version bump here — do that externally).
if [[ -z "${IMAGE_TAG:-}" ]]; then
  if [[ -f package.json ]]; then
    IMAGE_TAG="$(node -p "require('./package.json').version" 2>/dev/null || true)"
  elif [[ -f pyproject.toml ]]; then
    IMAGE_TAG="$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])" 2>/dev/null || true)"
  fi
fi
if [[ -z "${IMAGE_TAG:-}" ]]; then
  echo "Unable to determine IMAGE_TAG. Set IMAGE_TAG or bump the version first." >&2
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is required for ghcr.io login." >&2
  exit 1
fi

REGISTRY_USERNAME="$(derive_registry_username)"
IMAGE_REPO="${IMAGE_REPO:-$(derive_image_repo)}"

if [[ ${DRY_RUN} -eq 1 ]]; then
  echo "DRY RUN: echo '***' | docker login ghcr.io -u ${REGISTRY_USERNAME} --password-stdin"
else
  echo "Logging into ghcr.io as ${REGISTRY_USERNAME}"
  printf '%s' "${GITHUB_TOKEN}" | docker login ghcr.io -u "${REGISTRY_USERNAME}" --password-stdin
fi

ensure_builder

TAGS=(--tag "${IMAGE_REPO}:${IMAGE_TAG}")
if [[ "${PUSH_LATEST}" == "1" ]]; then
  TAGS+=(--tag "${IMAGE_REPO}:latest")
fi

BUILD_CMD=(
  docker buildx build
  --builder "${BUILDER_NAME}"
  --platform "${PLATFORMS}"
  --file Dockerfile
  "${TAGS[@]}"
  --push
  .
)

echo "Building ${IMAGE_REPO}:${IMAGE_TAG} for ${PLATFORMS}"

if [[ ${DRY_RUN} -eq 1 ]]; then
  printf 'DRY RUN:'
  printf ' %q' "${BUILD_CMD[@]}"
  printf '\n'
  exit 0
fi

"${BUILD_CMD[@]}"

echo "Pushed ${IMAGE_REPO}:${IMAGE_TAG}"
# Note: this must not be the script's final command — under `set -e` a false
# `[[ ]]` test would make the script exit 1 despite a successful push.
if [[ "${PUSH_LATEST}" == "1" ]]; then
  echo "Pushed ${IMAGE_REPO}:latest"
fi
