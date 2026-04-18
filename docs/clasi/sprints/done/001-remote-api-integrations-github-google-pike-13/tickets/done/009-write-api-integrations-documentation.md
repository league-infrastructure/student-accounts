---
id: 009
title: Write API integrations documentation
status: done
use-cases:
- SUC-001
depends-on:
- '004'
- '005'
- '007'
---

# Write API integrations documentation

## Description

Create `docs/api-integrations.md` — the developer guide for setting up
GitHub, Google, and Pike 13 credentials. Style: link to upstream docs,
don't paraphrase provider UIs.

## Changes

1. **`docs/api-integrations.md`** (new):
   - Overview: what integrations are available, architecture summary
   - **GitHub**: link to https://github.com/settings/developers, env var
     names, callback URL, scopes
   - **Google**: link to https://console.cloud.google.com/apis/credentials,
     consent screen note, env var names, callback URL, scopes
   - **Pike 13**: link to https://developer.pike13.com/docs/get_started,
     token acquisition process, env var name
   - **Secrets flow**: how secrets get from `secrets/*.env` → `.env` →
     env vars → app code (link to `docs/secrets.md`)
   - **Removing the example page**: delete `ExampleIntegrations.tsx`,
     revert `App.tsx`, backend routes stay
   - **Production notes**: add needed swarm secrets, remove example before
     deploying

## Documentation Style

- Link to upstream provider pages for registration steps
- Only document: what env var names to use, what callback URLs to set,
  what scopes are requested
- Do NOT describe provider UI flows ("click here, then there")

## Acceptance Criteria

- [ ] `docs/api-integrations.md` exists with sections for all 3 services
- [ ] Each section has upstream links (not paraphrased UI instructions)
- [ ] Env var names match what the code actually reads
- [ ] Callback URLs match the routes in `auth.ts`
- [ ] "Removing the example page" section exists
- [ ] "Production notes" section exists

## Testing

- **Existing tests to run**: None (docs only)
- **New tests to write**: None
- **Verification command**: Review document manually
