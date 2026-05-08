---
id: '017'
title: 'Client: make signup discoverable - Login Sign up link and Signup Passphrase
  input field'
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: make-signup-discoverable-login-link-visible-passphrase-field.md
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: make signup discoverable - Login Sign up link and Signup Passphrase input field

## Description

Makes signup discoverable from the login page and promotes the passphrase
from a URL-only parameter to an editable form field on the Signup page.

## Acceptance Criteria

- [x] Login page renders a "Need an account? Sign up" link pointing to `/signup`, styled to match Signup's footer link
- [x] The Sign-up link is placed just above the OAuth divider
- [x] Signup page has a Passphrase field as the first input in the form (above Username)
- [x] The Passphrase field is required, with helper text "The phrase your instructor gave you"
- [x] When the page loads with `?passphrase=<value>`, the Passphrase field is pre-filled with that value and remains editable
- [x] When no `?passphrase=` param is present, the Passphrase field is empty
- [x] The POST body sends the current passphrase field value (not a direct `searchParams.get(...)` call)

## Testing

- **Existing tests to run**: `npm run test:client -- Login Signup`
- **New tests to write**:
  - Login: asserts Sign-up link renders with `href="/signup"`
  - Signup: passphrase field renders empty by default; pre-fills from URL; user can edit; submit posts current field value
- **Verification command**: `npm run test:client -- Login Signup`
