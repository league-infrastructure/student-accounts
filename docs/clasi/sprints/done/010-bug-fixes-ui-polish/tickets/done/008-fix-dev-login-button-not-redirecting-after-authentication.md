---
id: "008"
title: "Fix Dev Login button not redirecting after authentication"
status: done
use-cases: []
depends-on: []
---

# Fix Dev Login button not redirecting after authentication

## Description

The Dev Login button calls `POST /api/auth/test-login` via fetch, then
`login(user)` to set AuthContext state. But the Login page has no navigation
after login — user stays on `/login`. Add `useNavigate` to redirect to `/`
after successful dev login.

## Acceptance Criteria

- [x] Dev Login button redirects to `/` after successful authentication
- [x] All existing tests pass

## Testing

- **Existing tests to run**: `npm run test:client`
- **Verification command**: `npm run test:client`
