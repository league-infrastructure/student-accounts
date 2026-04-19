---
id: '005'
title: "Link-mode OAuth \u2014 attach new Login to current user instead of creating\
  \ a new user"
status: done
use-cases:
- SUC-002
depends-on:
- '002'
github-issue: ''
todo: ''
---

# Link-mode OAuth — attach new Login to current user instead of creating a new user

## Description

Sprint 002 added a `?link=1` query parameter to the OAuth initiation routes
(`/api/auth/google?link=1`, `/api/auth/github?link=1`) but left the callback
handler as a stub that fell through to the normal sign-in path. This ticket
completes the link-mode flow so that a signed-in student can add a new OAuth
provider to their existing User account.

This is the backend side of UC-010 (Student Adds Own Login). The frontend
side (the Add button) is in T006.

## Acceptance Criteria

- [x] `GET /api/auth/google?link=1` sets `session.link = true` and
      `session.linkReturnTo = '/account'` before redirecting to Google OAuth.
- [x] `GET /api/auth/github?link=1` does the same for GitHub.
- [x] In the OAuth callback, when `session.link === true` and `session.userId`
      is set, the handler attaches the new Login to the current user instead
      of running the normal sign-in handler.
- [x] If the provider_user_id is already attached to the current user (same
      user clicking Add again), the flow is idempotent — no error, redirects
      to `/account`.
- [x] If the provider_user_id is already attached to a DIFFERENT user, the
      link is rejected; redirects to `/account?error=already_linked`.
- [x] A new Login record is created with correct provider, provider_user_id,
      provider_email, provider_username fields.
- [x] `add_login` AuditEvent is recorded atomically with Login creation,
      actor_user_id = the current session user.
- [x] After the link flow, `session.link` and `session.linkReturnTo` flags
      are cleared.
- [x] If `session.link === true` but `session.userId` is absent (unauthenticated
      user somehow hitting the link path), fall through to normal sign-in
      (treat as if `?link=1` was not present).
- [x] Existing Sprint 002 sign-in tests still pass (normal flow unchanged).

## Implementation Plan

### Approach

Modify the OAuth callback handlers in `server/src/routes/auth.ts`. In each
callback, check `req.session.link` before invoking the sign-in handler:

```
if (req.session.link && req.session.userId) {
  // Link mode
  const existingLogin = LoginService.findByProvider(provider, profile.id)
  if (existingLogin?.user_id === session.userId) { redirect('/account') }
  if (existingLogin && existingLogin.user_id !== session.userId) {
    redirect('/account?error=already_linked')
  }
  await LoginService.create({ userId: session.userId, provider, ... })
  // audit recorded inside LoginService.create
  delete session.link; delete session.linkReturnTo;
  redirect('/account')
}
// else: normal sign-in handler
```

Create a `server/src/services/auth/link.handler.ts` to keep this logic
out of the route file and make it independently testable. The route calls
`linkHandler` when link mode is detected.

### Files to Modify

- `server/src/routes/auth.ts` — detect link mode, delegate to link handler
- `server/src/services/auth/sign-in.handler.ts` — no change to normal path

### Files to Create

- `server/src/services/auth/link.handler.ts` — link-mode logic, testable
  independently of the HTTP layer

### Testing Plan

Integration tests in `tests/server/routes/auth.test.ts` (extend existing
Sprint 002 tests):

1. Signed-in user initiates Google link-mode → session.link set, OAuth redirect.
2. Link mode callback with new provider → Login created, audit recorded,
   redirect to /account.
3. Link mode callback where provider_user_id already belongs to current user →
   idempotent, redirect to /account.
4. Link mode callback where provider_user_id belongs to a different user →
   redirect to /account?error=already_linked.
5. Link mode with no session userId → falls through to normal sign-in.
6. Normal sign-in path (no ?link=1) → unchanged behavior (regression test).

Unit test `link.handler.ts` independently using fakes for LoginService.
