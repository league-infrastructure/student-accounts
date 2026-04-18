---
id: '004'
title: Create deploy script with pre-flight checks
status: done
use-cases:
- SUC-003
depends-on:
- '003'
---

# Create deploy script with pre-flight checks

## Description

Create `scripts/deploy.sh` with pre-flight validation (clean tree, correct
branch, version tag on HEAD, Docker available, required env vars) followed
by the full build/push/deploy/migrate pipeline.

## Acceptance Criteria

- [ ] `scripts/deploy.sh` exists and is executable
- [ ] Pre-flight rejects dirty working tree with clear error
- [ ] Pre-flight rejects non-main/master branch
- [ ] Pre-flight rejects missing version tag on HEAD
- [ ] Pre-flight rejects missing APP_DOMAIN, GITHUB_ORG, APP_NAME
- [ ] On success: builds Docker image, pushes to registry, deploys stack, runs migrations
- [ ] `npm run deploy` invokes the script
- [ ] Migration service cleans itself up after completion

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: Covered in ticket #005
- **Verification command**: `npm run test:server`
