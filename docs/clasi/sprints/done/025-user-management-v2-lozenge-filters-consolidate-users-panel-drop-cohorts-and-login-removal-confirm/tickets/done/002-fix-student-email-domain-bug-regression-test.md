---
id: '002'
title: Fix student email-domain bug + regression test
status: done
use-cases:
- SUC-002
depends-on: []
github-issue: ''
todo: ''
completes_todo: false
---

# Fix student email-domain bug + regression test

## Description

`StudentAccountsPanel.tsx` filters the `/api/admin/users` response using
`STUDENT_EMAIL_RE = /@students\.[a-z0-9.-]+$/i`, which matches only users
whose primary email ends in `@students.<something>`. A student whose primary
email is `eric@civicknowledge.com` (or any non-League domain) passes the role
check on the server but is silently excluded client-side by the regex.

The correct predicate is `role === 'student'` (normalized to lowercase).
Email domain is irrelevant.

After sprint 025 consolidation (ticket 005), the lozenge Student filter in
`AdminUsersPanel` will use this same role-based predicate. This ticket fixes
the bug in `StudentAccountsPanel` first — it is a quick independent win —
and adds a regression test so the unified panel carries the same guarantee
forward.

## Acceptance Criteria

- [x] `StudentAccountsPanel.tsx` filters to `role === 'student'` (case-insensitive normalize); the `STUDENT_EMAIL_RE` regex filter is removed.
- [x] A student user with `email: 'eric@civicknowledge.com'` and `role: 'student'` (or `role: 'USER'` as returned by the API, which normalizes to student) appears in the Students list.
- [x] A regression test in `tests/client/pages/Account.test.tsx` or a new `tests/client/pages/StudentAccountsPanel.test.tsx` asserts that a user with `role: 'USER'` and a non-League email is visible in the panel. (If the panel will be deleted in ticket 006, the test may live in `AdminUsersPanel.test.tsx` instead and cover the Student lozenge predicate — coordinate with ticket 005.)
- [x] `AdminUsersPanel.tsx` `filterUsers` `students` case is audited: the current code is `normalizeRole(u.role) === 'student'`, which is already correct. Confirm this does not include an email-domain check. If it does, remove it.

## Implementation Plan

### Approach

Read `StudentAccountsPanel.tsx` line 179: `const students = (users ?? []).filter((u) => STUDENT_EMAIL_RE.test(u.email))`. Replace with `const students = (users ?? []).filter((u) => normalizeRole(u.role) === 'student')`. Add or reuse a `normalizeRole` helper (identical to the one in `AdminUsersPanel.tsx`). Audit `AdminUsersPanel.tsx` `filterUsers` students case — confirmed correct by reading source.

### Files to modify

- `client/src/pages/admin/StudentAccountsPanel.tsx` — replace STUDENT_EMAIL_RE predicate with role-based predicate

### Files to create or modify (tests)

- `tests/client/pages/StudentAccountsPanel.test.tsx` (create or extend) — add regression test for non-League-email student visibility

### Testing plan

- New test: render `StudentAccountsPanel` with mock data containing one user `{ role: 'USER', email: 'test@civicknowledge.com' }`. Assert the user's name/email appears in the rendered output.
- Run full client test suite: `npm run test:client`

### Documentation updates

None required.
