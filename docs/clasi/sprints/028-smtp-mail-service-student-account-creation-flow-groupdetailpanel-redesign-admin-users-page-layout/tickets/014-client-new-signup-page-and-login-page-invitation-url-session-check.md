---
id: '014'
title: 'Client: new /signup page and Login page invitation-URL session check'
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: new /signup page and Login page invitation-URL session check

## Description

Adds a new `/signup` page for invitation-URL-based account creation, and updates
the `/login` page to handle `?passphrase=<value>` in the URL by checking the
session and either redirecting to `/account` (already signed in) or to
`/signup?passphrase=<value>` (not signed in).

The old passphrase-signup fallback on the Login form submit has been removed — it
is replaced by the dedicated Signup page.

## Acceptance Criteria

- [x] New `client/src/pages/Signup.tsx` page mounted at `/signup` (public, no auth required).
- [x] Signup page reads `?passphrase=<value>` from URL and includes it in the POST body.
- [x] Signup form has four fields: Username, Password, Full name, Email.
- [x] Signup page has "Already have an account? Sign in" link to `/login`.
- [x] Signup POSTs to `/api/auth/passphrase-signup` with the five-field body; on success navigates to `/account`.
- [x] Signup shows inline error from server response on failure (including 409 username-taken).
- [x] Login page: when `?passphrase=` is in the URL, hits `/api/auth/me`. If 200, navigates to `/account` (or `?next=` if present and safe). If 401, navigates to `/signup?passphrase=<value>`.
- [x] Login page: old passphrase-signup fallback from form submit is removed.
- [x] `/signup` route added in `client/src/App.tsx` alongside `/login`.
- [x] Tests: `tests/client/pages/Signup.test.tsx` — form renders, posts correct body, navigates on success, shows errors on failure.
- [x] Tests: `tests/client/pages/Login.test.tsx` — `?passphrase=` redirects to /signup (401) or /account (200).
- [x] Pre-existing Login test files updated to reflect removed passphrase-signup fallback.

## Testing

- **Existing tests updated**: `tests/client/Login.test.tsx`, `tests/client/LoginPage.test.tsx` — updated two tests each that expected the old passphrase-signup fallback.
- **New tests written**:
  - `tests/client/pages/Signup.test.tsx` — 11 tests
  - `tests/client/pages/Login.test.tsx` — 6 tests
- **Verification command**: `npm run test:client -- Signup Login`
