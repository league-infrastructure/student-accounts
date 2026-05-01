---
id: "009"
title: "Login page next param honors same-origin redirects"
status: todo
use-cases:
  - SUC-019-001
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Login page next param honors same-origin redirects

## Description

Modify `client/src/pages/Login.tsx` and (if it does any server-side
redirect on its own) the corresponding server login handler — likely
under `server/src/routes/auth/` — per `architecture-update.md` §
"Modified Modules (Client)" and § Risks "Same-origin `next=`
validation". This is the gate that lets `GET /oauth/authorize` (ticket
005) bounce an unauthenticated user through login and back, without
becoming an open-redirect.

**Client behavior:**

1. On mount, read the `next` URL search param (`new URLSearchParams(window.location.search).get('next')`).
2. After a successful login response, if `next` is set and passes
   validation (below), call `window.location.assign(next)`. Otherwise
   fall back to the existing `/account` redirect (or whatever the
   current Login page does on success — preserve it).

**Same-origin path validation** (this IS the security check, isolate
it as a small pure helper for unit-testing — e.g.
`client/src/pages/login/isSafeNext.ts` exporting
`isSafeNext(next: string | null): boolean`):

- Must be a string starting with exactly one `/` followed by a
  character that is NOT `/` and NOT `\`. So `/account` ok, `//evil.com`
  rejected, `/\evil.com` rejected.
- Must not contain control characters (`\x00`–`\x1f`).
- Must not start with `javascript:` (caught by the leading-`/` rule
  but assert explicitly in tests).
- Reject anything else, including absolute URLs, scheme-relative URLs,
  empty string, null.

Do NOT use `new URL(next, location.origin).origin === location.origin`
as the only check — it's been bypassed historically by tricky
encodings. The leading-`/`-then-non-`/`-non-`\` rule is the
belt-and-suspenders pattern.

**Server side:** if the existing login route at
`server/src/routes/auth/login.ts` (or wherever it lives — grep for the
existing `POST /api/auth/login` or similar) responds with a redirect,
apply the same validation there too. If it currently returns JSON and
the client handles redirection, no server changes needed beyond
making sure it doesn't strip the `next` param from the eventual
response.

Document the rule with a brief inline comment pointing at this ticket
and the open-redirect risk noted in `architecture-update.md`.

## Acceptance Criteria

- [ ] `client/src/pages/Login.tsx` reads `next` from URL and uses it on success when `isSafeNext(next)` returns true.
- [ ] `isSafeNext` is exported as a standalone pure helper that can be unit-tested without rendering the page.
- [ ] If the server login route also issues redirects, the same validation applies there.
- [ ] All attack-vector tests pass (see Testing).
- [ ] No regression in the existing post-login redirect to `/account` when `next` is absent or invalid.

## Testing

- **Existing tests to run**: `npm run test:client`, `npm run test:server`
- **New tests to write**:
  - Unit tests for `isSafeNext` — table-driven:
    - `'/account'` → true
    - `'/oauth/authorize?response_type=code&client_id=abc'` → true
    - `'//evil.com'` → false (scheme-relative attack)
    - `'///evil.com'` → false
    - `'/\\evil.com'` (single backslash after `/`) → false
    - `'https://evil.com'` → false
    - `'http://evil.com/path'` → false
    - `'javascript:alert(1)'` → false
    - `''` → false
    - `null` → false
    - `'/legit/path'` → true
    - `'/legit?with=query&more=params'` → true
    - `'/with\x00nullbyte'` → false
  - Component test on `Login.tsx`: mount with `?next=/oauth/authorize?...`, simulate successful login, assert `window.location.assign` called with the next URL.
  - Component test: mount with `?next=//evil.com`, simulate successful login, assert redirect goes to `/account`, NOT to evil.com.
  - Component test: no `next` param, asserts redirect to `/account`.
- **Verification command**: `npm run test:client && npm run test:server`
