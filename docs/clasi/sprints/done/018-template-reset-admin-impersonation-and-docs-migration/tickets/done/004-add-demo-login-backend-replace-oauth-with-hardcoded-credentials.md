---
id: '004'
title: Add demo login backend (replace OAuth with hardcoded credentials)
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '001'
github-issue: ''
todo: plan-revert-template-app-to-simple-two-button-counter-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 004 — Add demo login backend (replace OAuth with hardcoded credentials)

## Description

Add the `POST /api/auth/demo-login` endpoint that accepts a username/password body and
authenticates against two hardcoded credential pairs:
- `user` / `pass` → USER role, email `user@demo.local`
- `admin` / `admin` → ADMIN role, email `admin@demo.local`

Both pairs use a finds-or-creates pattern for the User record so the endpoint works
without a separate user seed.

Ticket 001 must complete first (removes OAuth strategy registrations and simplifies
`deserializeUser`). Runs in Group 2 parallel with ticket 003.

Also add or update a `POST /api/auth/logout` endpoint if one does not exist. The existing
OAuth-based login routes can be removed here if ticket 001 did not already do so.

## Files to Modify

**`server/src/routes/auth.ts`:**

Add endpoint `POST /api/auth/demo-login`:
```
Body: { username: string, password: string }

const DEMO_CREDENTIALS = [
  { username: 'user',  password: 'pass',  email: 'user@demo.local',  role: 'USER'  },
  { username: 'admin', password: 'admin', email: 'admin@demo.local', role: 'ADMIN' },
];

- Match body against DEMO_CREDENTIALS (exact string match, no hashing needed).
- If match found: prisma.user.upsert({ where: { email }, update: {}, create: { email, displayName: username, role } }).
- Call req.login(user, callback) to establish Passport session.
- Return 200 { id, email, displayName, role } on success.
- Return 401 { error: 'Invalid credentials' } on no match.
- Return 400 if body is missing username or password.
```

Remove any remaining OAuth callback routes (`/api/auth/pike13/*`, `/api/auth/google/*`,
`/api/auth/github/*`) if ticket 001 did not already do so.

Ensure `POST /api/auth/logout` exists and calls `req.logout()` then destroys the session.

**`server/src/types/express.d.ts`** (or equivalent augmentation file):
- Ensure `req.login()` type signature is available (should already be there via Passport
  types, but verify).

## Acceptance Criteria

- [x] `POST /api/auth/demo-login` with `user`/`pass` → 200, session established, role = USER
- [x] `POST /api/auth/demo-login` with `admin`/`admin` → 200, session established, role = ADMIN
- [x] `POST /api/auth/demo-login` with unknown credentials → 401 `{ error: "Invalid credentials" }`
- [x] `POST /api/auth/demo-login` with missing body fields → 400
- [x] After demo-login, `GET /api/auth/me` returns the correct user object
- [x] `POST /api/auth/logout` destroys session and returns 200
- [x] No Pike13/Google/GitHub OAuth routes remain in `routes/auth.ts`
- [x] TypeScript compiles without errors

## Implementation Plan

1. Open `server/src/routes/auth.ts`; read current structure.
2. Define `DEMO_CREDENTIALS` constant.
3. Add `POST /api/auth/demo-login` handler with upsert + `req.login()`.
4. Remove any remaining OAuth callback routes.
5. Confirm `POST /api/auth/logout` exists and is correct.
6. Run `tsc --noEmit` to verify types.

## Testing

- **Existing tests to run**: `npm run test:server` — auth tests that remain must pass.
- **New tests to write**:
  - `POST /api/auth/demo-login` with `user`/`pass` → 200 and session cookie set
  - `POST /api/auth/demo-login` with `admin`/`admin` → 200 and `role: ADMIN`
  - `POST /api/auth/demo-login` with bad credentials → 401
  - After login, `GET /api/auth/me` returns correct user
- **Verification command**: `npm run test:server`
