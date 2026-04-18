---
id: '003'
title: Add integration status endpoint
status: done
use-cases:
- SUC-005
depends-on:
- '002'
---

# Add integration status endpoint

## Description

Create `server/src/routes/integrations.ts` with a single endpoint that
reports which external integrations have credentials configured.

## Changes

1. **`server/src/routes/integrations.ts`** (new):
   - `GET /api/integrations/status` → returns configuration status
   - Checks: `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`,
     `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, `PIKE13_ACCESS_TOKEN`
   - Returns `{ github: { configured: bool }, google: { ... }, pike13: { ... } }`
   - Never exposes actual values

2. **`server/src/index.ts`** — register the integrations router

## Acceptance Criteria

- [ ] `GET /api/integrations/status` returns JSON with all three services
- [ ] With no env vars, all report `configured: false`
- [ ] Setting env vars changes the corresponding field to `true`
- [ ] No secret values exposed in the response
- [ ] Server starts and responds with zero integration env vars

## Testing

- **Existing tests to run**: `npm run test:server` (smoke tests from ticket 010)
- **New tests to write**: `tests/server/integrations.test.ts`
  - With no OAuth env vars set: all three services report `configured: false`
  - With `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` set: GitHub reports `true`
  - With `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set: Google reports `true`
  - With `PIKE13_ACCESS_TOKEN` set: Pike 13 reports `true`
  - Response never contains actual secret values (assert no env var values
    appear in response body)
  - Response shape matches `{ github: { configured: bool }, ... }`
- **Verification command**: `npm run test:server`
