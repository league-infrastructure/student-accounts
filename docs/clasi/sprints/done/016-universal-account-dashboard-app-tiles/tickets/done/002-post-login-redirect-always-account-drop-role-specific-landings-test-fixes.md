---
id: '002'
title: "Post-login redirect \u2014 always /account, drop role-specific landings +\
  \ test fixes"
status: done
use-cases:
- SUC-016-001
depends-on: []
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Post-login redirect — always /account, drop role-specific landings + test fixes

## Description

Today `postLoginRedirect()` in `server/src/routes/auth.ts` returns:
- `/` for admin
- `/staff/directory` for staff
- `/account` for everyone else

The new universal-dashboard model says every authenticated user lands on
`/account`. Simplify the function to always return `/account` and remove the
role-specific branches.

The function is called from three OAuth callbacks (Google, GitHub, Pike13) and
from the `passphrase-signup` and `login` handlers. Changing the function body
fixes all call sites.

**Modified files:**

- `server/src/routes/auth.ts` — `postLoginRedirect()` body becomes
  `return '/account';`.
- Any test that asserts `expect(res.headers.location).toBe('/staff/directory')`
  or `.toBe('/')` after a successful sign-in needs to assert `/account`
  instead.

**Test files known to depend on the old behavior (search for `staff/directory`
and `redirects admin` in the test suite to find the full set):**

- `tests/server/routes/auth.google.test.ts`
- `tests/server/routes/auth.github.test.ts`
- `tests/server/routes/auth.pike13.test.ts`
- `tests/server/auth-flows.integration.test.ts`

These tests need their expected `Location` header updated to `/account`. The
test descriptions can be left as-is (or renamed to "redirects all roles to
/account") at the implementer's discretion.

## Acceptance Criteria

- [x] `postLoginRedirect()` in `server/src/routes/auth.ts` returns `/account` regardless of role.
- [x] No call site of `postLoginRedirect()` was missed (grep for the function name and confirm all callers still get `/account`).
- [x] All previously-passing OAuth callback tests are updated to expect `/account` and now pass.
- [x] Server test suite returns to a green baseline (1407 passing modulo the known SQLite ordering flake).

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: none — this ticket is a behavior change covered by updating existing tests.
- **Verification command**: `npm run test:server`
