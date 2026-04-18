---
id: '003'
title: Add date-based version script and expose version in health endpoint
status: done
use-cases:
- SUC-002
depends-on: []
---

# Add date-based version script and expose version in health endpoint

## Description

Create `scripts/version.sh` that calculates the next `0.YYYYMMDD.N` version
based on existing git tags. Add npm scripts for `version:bump` and `version:tag`.
Update the health endpoint to include the app version.

## Acceptance Criteria

- [ ] `scripts/version.sh` outputs `0.YYYYMMDD.N` format
- [ ] Script increments N when same-day tags exist
- [ ] Script resets N to 1 on a new day
- [ ] `npm run version:bump` prints the next version
- [ ] `npm run version:tag` creates an annotated git tag
- [ ] Health endpoint returns `version` field in response
- [ ] `APP_VERSION` env var overrides tag-based detection

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: Covered in ticket #005
- **Verification command**: `npm run test:server`
