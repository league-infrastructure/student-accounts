---
id: '006'
title: Production login endpoint (POST /api/auth/login) + tests + client wiring
status: done
use-cases:
- SUC-006
depends-on:
- '002'
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 006 — Production login endpoint: POST /api/auth/login + tests + client wiring

## Description

Implement a real `POST /api/auth/login` endpoint backed by `crypto.scrypt` password verification. This replaces the `/api/auth/test-login` dev-only stub as the target of the client login form. The existing `test-login` endpoint is left untouched; only the client form's endpoint is changed.

## Acceptance Criteria

### Server — `server/src/routes/auth/login.ts`

- [x] File created; exports an Express `Router` with `POST /` mounted at `/api/auth/login` via `server/src/app.ts`.
- [x] Route is public (no `requireAuth` middleware).
- [x] Handler:
  1. Validates body: `username` (string, required) and `password` (string, required). Returns `401` for missing/non-string fields (generic — same body as all other failure cases to prevent enumeration).
  2. Looks up `User` by `username` (lowercase). If not found, returns `401 { error: 'Invalid username or password' }` (generic — no enumeration).
  3. If `user.password_hash` is null (OAuth-only user), returns same generic `401`.
  4. Calls `verifyPassword(password, user.password_hash)`. If false, returns same generic `401`.
  5. Sets `req.session.userId = user.id` (and `req.session.role`); saves session.
  6. Returns `200 { id, username, displayName, primaryEmail, role }`.
- [x] `/api/auth/test-login` is not modified.

### Tests

- [x] `tests/server/routes/auth-login.test.ts` created and green (11 tests):
  - Happy path: correct username + correct password → 200, session set, /me returns user.
  - Wrong password → 401 with generic message, no session set.
  - Unknown username → 401 with generic message (identical to wrong-password response — no enumeration).
  - Inactive user → 401 with generic message.
  - User with `password_hash=null` (OAuth user) → 401 with generic message.
  - Missing `username` field → 401 generic.
  - Missing `password` field → 401 generic.
  - Empty body → 401 generic.
  - Username case-insensitivity: `Alice` logs in as `alice`.
  - End-to-end: passphrase-signup → login with same credentials → 200.
- [x] `npm run test:server` passes with the new suite included (1 pre-existing flaky failure unrelated to this ticket).
- [x] `npx tsc --noEmit` in `server/` shows no new errors beyond pre-existing 21.

### Client — `client/src/context/AuthContext.tsx`

- [x] `loginWithCredentials` repointed from `/api/auth/test-login` to `/api/auth/login` with `{ username, password }` body (hardcoded mapping removed).
- [ ] The password input is `type="text"` (visible, so students can verify the passphrase as they type). — deferred to Ticket 008.
- [ ] Labels read "Username" and "Passphrase". — deferred to Ticket 008.
- [ ] On `200`: `window.location.assign('/account')`. — deferred to Ticket 008.
- [x] On `401`: inline error message shown below the form (pre-existing behaviour in Login.tsx).

Note: The full passphrase-signup disclosure panel is Ticket 008. This ticket only handles the main login form rewiring.

## Implementation Plan

### Approach

Thin route, thin handler. `verifyPassword` from Ticket 002 does the heavy lifting. The generic 401 is intentional — implement it as a single response path after any lookup or verification failure.

### Files to Create

- `server/src/routes/auth/login.ts`
- `tests/server/routes/auth-login.test.ts`

### Files to Modify

- `server/src/routes/auth.ts` — mount `login` router at `/api/auth/login`.
- `client/src/pages/Login.tsx` — change form submit target, input type, and labels.

### Testing Plan

- Server integration tests as above.
- Client-side test changes are owned by Ticket 008 (`Login.test.tsx`); this ticket only modifies the main form target.
- Run `npm run test:server`, `npx tsc --noEmit` in `server/`, and `npx tsc --noEmit` in `client/`.

### Documentation Updates

None.
