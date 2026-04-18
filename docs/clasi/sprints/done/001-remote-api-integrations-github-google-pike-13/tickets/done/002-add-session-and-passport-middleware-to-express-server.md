---
id: '002'
title: Add session and Passport middleware to Express server
status: done
use-cases:
- SUC-002
- SUC-003
depends-on:
- '001'
---

# Add session and Passport middleware to Express server

## Description

Install session and Passport dependencies and configure the middleware
stack in `server/src/index.ts`. This establishes the auth infrastructure
that the OAuth strategy tickets build on.

## Changes

1. **`server/package.json`** — install:
   - Runtime: `express-session`, `passport`
   - Dev: `@types/express-session`, `@types/passport`

2. **`server/src/index.ts`**:
   - Remove `cors()` middleware and uninstall `cors` package
   - Add `app.set('trust proxy', 1)`
   - Add `express-session` middleware (after pinoHttp, before routes):
     - `secret`: `process.env.SESSION_SECRET || 'dev-secret-change-me'`
     - `resave: false`, `saveUninitialized: false`
     - `cookie.secure`: `process.env.NODE_ENV === 'production'`
     - `cookie.sameSite`: `'lax'`, `cookie.httpOnly`: `true`
   - Add `passport.initialize()` and `passport.session()`
   - Add `passport.serializeUser` / `passport.deserializeUser` (full object)

## Acceptance Criteria

- [ ] `cors` package removed from `server/package.json`
- [ ] `express-session` and `passport` installed
- [ ] Session middleware registered between pinoHttp and routes
- [ ] `trust proxy` set to 1
- [ ] Cookie configured with `secure`, `sameSite`, `httpOnly`
- [ ] Server starts cleanly with no integration env vars set
- [ ] `GET /api/health` still returns `{ status: 'ok' }`
- [ ] `GET /api/counter` still works

## Testing

- **Existing tests to run**: `npm run build`
- **New tests to write**: None (middleware only)
- **Verification command**: `npm run build`
