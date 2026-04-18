---
id: "007"
title: "Fix OAuth strategies not registering due to ESM import hoisting"
status: done
use-cases: []
depends-on: []
---

# Fix OAuth strategies not registering due to ESM import hoisting

## Description

In `server/src/index.ts`, `dotenv.config()` is called in the module body, but
`import app from './app'` is a static ESM import that gets hoisted above it.
This means `auth.ts` evaluates before env vars are loaded, so the
`if (process.env.GITHUB_CLIENT_ID && ...)` guards fail and OAuth strategies
never register.

Fix by converting the `app` import to a dynamic `import()` after dotenv runs.

## Acceptance Criteria

- [x] OAuth strategies register when env vars are in `.env`
- [x] GitHub and Google login initiation endpoints return 302 (not 501)
- [x] All existing tests pass

## Testing

- **Existing tests to run**: `npm run test:server`
- **Verification command**: `npm run test:server`
