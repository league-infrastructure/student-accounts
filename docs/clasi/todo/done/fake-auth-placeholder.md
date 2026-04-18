---
title: Fake placeholder user masks auth failures
priority: high
status: done
sprint: '010'
tickets:
- '001'
---

## Problem

`AuthContext.tsx` falls back to a hardcoded placeholder user when
`GET /api/auth/me` returns 401:

```typescript
const PLACEHOLDER_USER: AuthUser = {
  id: 0,
  email: 'eric@example.com',
  displayName: 'Eric Busboom',
  role: 'USER',
  ...
};
```

This makes the app appear logged in when no session exists. But the user
has `id: 0` which doesn't exist in the database, so every authenticated
API call (channels, messages, etc.) fails with 401/403.

The result: the UI shows "Welcome, Eric Busboom" but nothing actually works.

## Expected Behavior

When unauthenticated, the app should either:
- Show a login/landing page directing users to sign in (OAuth or test-login)
- Auto-login via the test-login endpoint in development mode
- At minimum, not pretend to be a specific real person

## Files

- `client/src/context/AuthContext.tsx` — placeholder user logic
- `server/src/routes/auth.ts` — test-login endpoint exists but isn't used
