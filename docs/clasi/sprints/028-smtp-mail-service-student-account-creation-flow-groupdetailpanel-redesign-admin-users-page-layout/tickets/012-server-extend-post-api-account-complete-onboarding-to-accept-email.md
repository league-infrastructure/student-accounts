---
id: '012'
title: 'Server: extend POST /api/account/complete-onboarding to accept email'
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: extend POST /api/account/complete-onboarding to accept email

## Description

Extend POST /api/account/complete-onboarding to accept an optional `email`
field alongside the existing `displayName`. When provided, validate it is a
non-empty string with a basic shape check (contains `@` and a dot after it),
normalize to lowercase, and persist it as `User.primary_email`. The existing
`displayName` + `onboarding_completed=true` behavior is unchanged.

## Acceptance Criteria

- [x] POST /api/account/complete-onboarding accepts optional `email` in body
- [x] When `email` is provided, validate it is a non-empty string with `@` and a dot after it; reject with 400 on invalid shape
- [x] When `email` is provided and valid, normalize to lowercase and set `User.primary_email`
- [x] When `email` is omitted, only `display_name` and `onboarding_completed` are updated (existing behavior unchanged)
- [x] Unauthenticated requests continue to return 401
- [x] `displayName` validation (non-empty, <= 120 chars) is unchanged

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `tests/server/routes/account-complete-onboarding.test.ts` (13 tests)
- **Verification command**: `npm run test:server`
