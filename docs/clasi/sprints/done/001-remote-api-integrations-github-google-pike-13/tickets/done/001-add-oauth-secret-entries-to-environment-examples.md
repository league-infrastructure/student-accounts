---
id: '001'
title: Add OAuth secret entries to environment examples
status: done
use-cases:
- SUC-001
depends-on: []
---

# Add OAuth secret entries to environment examples

## Description

Update the secret example files so developers know which environment
variables to configure for the three integrations. This is the foundation
ticket — all other tickets reference these env var names.

## Changes

1. **`secrets/dev.env.example`** — append entries for GitHub, Google, Pike 13
2. **`secrets/prod.env.example`** — same entries
3. **`docs/secrets.md`** — update the Required Secrets table

Secret entries to add:

```
# --- GitHub OAuth ---
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# --- Google OAuth ---
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# --- Pike 13 API ---
PIKE13_ACCESS_TOKEN=your-pike13-access-token
```

## Acceptance Criteria

- [ ] `secrets/dev.env.example` contains all 5 new entries grouped under comments
- [ ] `secrets/prod.env.example` contains the same entries
- [ ] `docs/secrets.md` Required Secrets table lists the new secrets
- [ ] `npm run build` still succeeds

## Testing

- **Existing tests to run**: `npm run build`
- **New tests to write**: None (config files only)
- **Verification command**: `npm run build`
