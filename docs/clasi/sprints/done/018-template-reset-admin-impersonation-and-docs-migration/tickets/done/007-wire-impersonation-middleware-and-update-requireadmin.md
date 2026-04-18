---
id: '007'
title: Wire impersonation middleware and update requireAdmin
status: done
use-cases:
- SUC-006
depends-on:
- '001'
github-issue: ''
todo: plan-admin-user-impersonation.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 007 — Wire impersonation middleware and update requireAdmin

## Description

The `server/src/middleware/impersonate.ts` file already exists and implements the
impersonation logic (reads `req.session.impersonatingUserId`, loads the target user,
sets `req.user` to the target, and stores the real admin in `req.realAdmin`). This ticket
activates it by mounting it in `app.ts` and updates `requireAdmin.ts` to check
`req.realAdmin.role` when impersonation is active.

This is a two-file change with no new files needed.

Depends on ticket 001 (app.ts is cleaned up; Passport `deserializeUser` is simplified).
Runs in Group 2 parallel with 003, 004, 006.

## Files to Modify

**`server/src/app.ts`:**
- Import `impersonateMiddleware` from `./middleware/impersonate`.
- Mount it immediately after `passport.session()` and before any route registrations:
  ```ts
  app.use(passport.session());
  app.use(impersonateMiddleware);   // ← add here
  // ... routes follow
  ```

**`server/src/middleware/requireAdmin.ts`:**
Read the current implementation first to understand its guard logic. Then update:
```ts
// Before change: checks req.user.role === 'ADMIN'
// After change: if req.realAdmin exists, check req.realAdmin.role; else check req.user.role
const effectiveUser = (req as any).realAdmin ?? req.user;
if (!effectiveUser || effectiveUser.role !== 'ADMIN') {
  return res.status(403).json({ error: 'Forbidden' });
}
```
This allows admins to keep accessing admin routes while impersonating a non-admin user.

**`server/src/types/express.d.ts`** (or equivalent session augmentation):
Verify that `req.session.impersonatingUserId` and `req.session.realAdminId` are typed
(string | undefined). Add them if missing:
```ts
declare module 'express-session' {
  interface SessionData {
    impersonatingUserId?: string;
    realAdminId?: string;
  }
}
```
Also verify `req.realAdmin` is typed as `User | undefined` on Express.Request. Add if missing.

## Acceptance Criteria

- [x] `impersonateMiddleware` imported and mounted in `app.ts` after `passport.session()`
- [x] `requireAdmin.ts` checks `req.realAdmin.role` when `req.realAdmin` is present
- [x] `requireAdmin.ts` falls back to `req.user.role` when `req.realAdmin` is absent
- [x] Session type augmentation includes `impersonatingUserId` and `realAdminId`
- [x] `req.realAdmin` typed on Express.Request
- [x] TypeScript compiles without errors
- [x] `npm run test:server` passes

## Implementation Plan

1. Read `server/src/middleware/impersonate.ts` to understand exactly what it does.
2. Read `server/src/middleware/requireAdmin.ts` to understand current implementation.
3. Read `server/src/app.ts` to find the correct mount point (after `passport.session()`).
4. Edit `app.ts` — add import and `app.use(impersonateMiddleware)`.
5. Edit `requireAdmin.ts` — update role check to use `req.realAdmin ?? req.user`.
6. Check `server/src/types/` for existing session/request augmentations; add missing fields.
7. Run `tsc --noEmit`.
8. Run `npm run test:server`.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - When `req.session.impersonatingUserId` is set, `req.user` is the target user
  - When `req.session.impersonatingUserId` is set, `req.realAdmin` is the original admin
  - `requireAdmin` allows access when `req.realAdmin.role === 'ADMIN'` (even if
    `req.user.role === 'USER'`)
  - `requireAdmin` blocks access when neither `req.user` nor `req.realAdmin` is ADMIN
- **Verification command**: `npm run test:server`
