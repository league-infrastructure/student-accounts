---
title: No user-facing login page
priority: high
status: done
sprint: '010'
tickets:
- '001'
---

## Problem

There is no login page for regular users. The auth system supports:
- GitHub OAuth (`/api/auth/github`)
- Google OAuth (`/api/auth/google`)
- Test login endpoint (`POST /api/auth/test-login` — dev/test only)

But there is no UI to initiate any of these flows. The only login UI is
`AdminLogin.tsx` at `/admin`, which is for the admin panel only.

Without a login page, users can never authenticate, which means all
auth-gated features (chat, channels, etc.) are permanently broken.

## Expected Behavior

A login page at `/login` (or as part of the Home page for unauthenticated
users) that offers:
- OAuth buttons (GitHub, Google) when configured
- A dev-mode auto-login or test-login button in development

## Files

- `client/src/pages/admin/AdminLogin.tsx` — exists but admin-only
- `server/src/routes/auth.ts` — OAuth and test-login endpoints
- `client/src/App.tsx` — no `/login` route defined
