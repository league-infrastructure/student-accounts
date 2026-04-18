---
status: pending
priority: medium
source: inventory app (scripts/deploy.sh, package.json)
---

# Date-Based Version Management

Adopt a date-based version scheme (`0.YYYYMMDD.N`) for apps that deploy
frequently and don't need traditional semver semantics.

## Scheme

```
0.YYYYMMDD.N
```

- **0** — major version (pre-1.0 until the app is considered stable)
- **YYYYMMDD** — today's date
- **N** — sequential number, increments with each commit/tag on the
  same day, resets to 1 on a new day

Examples:
- `0.20260316.1` — first release on March 16, 2026
- `0.20260316.2` — second release that day
- `0.20260317.1` — first release on March 17

## Implementation

Add a version bump script (`scripts/version.sh` or in package.json):

```bash
#!/bin/bash
TODAY=$(date +%Y%m%d)
LATEST=$(git tag --list "v0.${TODAY}.*" --sort=-version:refname | head -1)

if [ -z "$LATEST" ]; then
  SEQ=1
else
  SEQ=$(echo "$LATEST" | grep -oP '\d+$')
  SEQ=$((SEQ + 1))
fi

VERSION="0.${TODAY}.${SEQ}"
echo "$VERSION"
```

Add npm scripts:

```json
{
  "version:bump": "scripts/version.sh",
  "version:tag": "VERSION=$(scripts/version.sh) && git tag -a v$VERSION -m \"Release $VERSION\" && echo \"Tagged v$VERSION\""
}
```

## Deploy Script Integration

The deploy script should:

1. Read the version from the latest git tag
2. Validate that the tag points to HEAD
3. Use the version for Docker image tagging
4. Pass the version to the app via build args or env vars

```bash
VERSION=$(git describe --tags --exact-match HEAD 2>/dev/null)
if [ -z "$VERSION" ]; then
  echo "ERROR: HEAD is not tagged. Run 'npm run version:tag' first."
  exit 1
fi
```

## Runtime Access

The app should know its own version at runtime:

```typescript
// Read from package.json or environment variable
const VERSION = process.env.APP_VERSION || require('../package.json').version;
```

Expose via the health endpoint:

```json
GET /api/health
{ "status": "ok", "version": "0.20260316.1" }
```

## Reference Files

- Inventory: `scripts/deploy.sh` (version validation)
- Inventory: `package.json` (version field)

## Verification

- `scripts/version.sh` outputs the correct version for today
- Second run on the same day increments the sequence number
- Deploy script refuses to deploy untagged commits
- Health endpoint returns the current version
