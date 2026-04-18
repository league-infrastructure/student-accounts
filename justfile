# Push: bump version and push to origin (master only)
push:
    #!/usr/bin/env bash
    set -euo pipefail
    branch=$(git rev-parse --abbrev-ref HEAD)
    if [ "$branch" != "master" ]; then
        echo "Error: push only allowed on master (currently on $branch)"
        exit 1
    fi
    version=$(bash scripts/version.sh)
    npm version "$version" --no-git-tag-version
    git add package.json
    git commit -m "v${version}"
    git tag "v${version}"
    git push origin master --tags
