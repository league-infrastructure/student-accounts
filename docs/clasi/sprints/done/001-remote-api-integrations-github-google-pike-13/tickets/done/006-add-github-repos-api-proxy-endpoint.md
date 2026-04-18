---
id: '006'
title: Add GitHub repos API proxy endpoint
status: done
use-cases:
- SUC-002
depends-on:
- '004'
---

# Add GitHub repos API proxy endpoint

## Description

Create a route that proxies requests to the GitHub API using the
authenticated user's access token stored in the session.

## Changes

1. **`server/src/routes/github.ts`** (new):
   - `GET /api/github/repos` — calls `https://api.github.com/user/repos`
     with `Authorization: token <accessToken>` from session
   - Returns array of `{ name, description, url, stars, language }`
   - Returns 401 if not logged in via GitHub
   - Returns 501 if GitHub is not configured

2. **`server/src/index.ts`** — register github router

## Acceptance Criteria

- [ ] `GET /api/github/repos` returns repos when logged in via GitHub
- [ ] Returns 401 when not authenticated
- [ ] Returns 501 when GitHub is not configured
- [ ] Response shape: `[{ name, description, url, stars, language }]`

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `tests/server/github.test.ts`
  - `GET /api/github/repos` when not authenticated → 401
  - `GET /api/github/repos` when GitHub not configured → 501 with docs URL
  - (Actual repo fetch requires real GitHub token — manual test only)
- **Verification command**: `npm run test:server`
