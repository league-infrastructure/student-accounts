---
status: done
sprint: '010'
tickets:
- 008
---

# Dev Login button does not redirect after successful authentication

## Description

The "Dev Login (test mode)" button on `/login` calls `POST /api/auth/test-login`
successfully and calls `login(user)` on AuthContext to set the user state, but the
Login page has no redirect logic. After authentication, the user stays on `/login`
instead of being redirected to `/`.

The OAuth buttons (`<a href="/api/auth/github">`) work differently — they navigate
the full browser to the API endpoint, which does a server-side redirect after the
OAuth flow completes. Dev Login uses `fetch()` instead, so the client must handle
navigation itself.

Fix: After `login(user)` succeeds in `handleDevLogin`, navigate to `/` using
React Router's `useNavigate` hook. Alternatively, add a guard at the top of the
Login component that redirects to `/` when user is already authenticated.
