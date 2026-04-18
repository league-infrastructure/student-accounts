---
id: '001'
title: "Fix auth flow \u2014 login page, remove placeholder, dev auto-login"
status: done
use-cases: []
depends-on: []
---

# Fix auth flow — login page, remove placeholder, dev auto-login

## Description

The AuthContext uses a hardcoded placeholder user ("Eric Busboom", id: 0) when
not authenticated. This makes the app appear logged in while all API calls
fail. There is no user-facing login page.

Fix by:
1. Remove the placeholder user from AuthContext — when unauthenticated, `user`
   should be `null`.
2. Create a Login page with OAuth buttons (GitHub, Google) and a dev-mode
   auto-login button that calls `POST /api/auth/test-login`.
3. Update AppLayout to redirect to Login when user is null.
4. After login, AuthContext re-fetches `/api/auth/me`.

## Acceptance Criteria

- [ ] Placeholder user removed from AuthContext
- [ ] Login page exists at `/login` with OAuth buttons
- [ ] Dev auto-login button visible in non-production mode
- [ ] Unauthenticated users are redirected to login
- [ ] After login, user can access auth-gated features (chat, etc.)

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
- **New tests to write**: Login page renders, dev login button works
- **Verification command**: `npm run test:client`
