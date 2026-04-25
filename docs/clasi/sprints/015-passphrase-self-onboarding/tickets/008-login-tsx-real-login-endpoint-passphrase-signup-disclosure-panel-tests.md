---
id: '008'
title: "Login.tsx — real login endpoint + passphrase-signup disclosure panel + tests"
status: todo
use-cases:
  - SUC-004
  - SUC-005
  - SUC-006
depends-on:
  - '006'
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 008 — Login.tsx: real login endpoint + passphrase-signup disclosure panel + tests

## Description

Complete the client-side authentication UI. Ticket 006 already wired the main login form to `/api/auth/login`; this ticket adds the passphrase-signup disclosure panel below the OAuth buttons and updates the Login tests to cover all flows. Together these two tickets deliver the full `/login` page experience.

## Acceptance Criteria

### Login.tsx changes

- [ ] Main login form (username + passphrase fields) POSTs to `/api/auth/login` (done in Ticket 006; verify in tests here).
- [ ] Password/passphrase input is `type="text"` so students can see what they're typing.
- [ ] Labels read "Username" and "Passphrase".
- [ ] A disclosure/collapsible section below the OAuth buttons is labeled "New student? Sign up with a class passphrase".
- [ ] Expanding the disclosure reveals a signup form with the same "Username" and "Passphrase" fields, POSTing to `POST /api/auth/passphrase-signup`.
- [ ] Both forms share the same input component and validation feedback pattern.
- [ ] On `200` from either form: `window.location.assign('/account')`.
- [ ] On `401` (login form): inline error "Invalid username or password".
- [ ] On `401` (signup form): inline error "Invalid or expired passphrase".
- [ ] On `409` (signup form): inline error "That username is already taken".
- [ ] On `400` (signup form): inline error from the server's `error` field.
- [ ] Disclosure is closed by default; opening one form does not affect the other.

### Tests

- [ ] `tests/client/Login.test.tsx` extended or rewritten (per TODO) to cover:
  - Login form submits to `/api/auth/login` (not `test-login`).
  - Login form passphrase input has `type="text"`.
  - Login form 200 → `window.location.assign('/account')`.
  - Login form 401 → inline error shown.
  - Disclosure section renders with the correct label.
  - Expanding disclosure reveals the signup form.
  - Signup form submits to `/api/auth/passphrase-signup`.
  - Signup form 200 → `window.location.assign('/account')`.
  - Signup form 401 → inline "Invalid or expired passphrase".
  - Signup form 409 → inline "That username is already taken".
- [ ] `npx tsc --noEmit` in `client/` shows no new errors.
- [ ] `npm run test:client` passes with the updated suite included.

## Implementation Plan

### Approach

Keep the two forms (login, signup) as sibling controlled-form blocks inside `Login.tsx`. The disclosure can be a plain `<details>`/`<summary>` or a simple `useState` toggle — whichever matches the existing UI pattern. No new component needed unless the file gets unwieldy; extract `PassphraseSignupForm` only if the file exceeds ~200 lines.

### Files to Modify

- `client/src/pages/Login.tsx` — add disclosure section with signup form.
- `tests/client/Login.test.tsx` — extend/rewrite as described.

### Testing Plan

- Component tests as above.
- `npx tsc --noEmit` in `client/`.
- `npm run test:client`.
- End-to-end verification is Ticket 009.

### Documentation Updates

None.
