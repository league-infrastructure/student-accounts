---
id: '013'
title: 'Server: OAuth signup paths leave onboarding_completed=false when no full name'
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: OAuth signup paths leave onboarding_completed=false when no full name

## Description

OAuth signup paths (Google, GitHub, Pike 13) now set `onboarding_completed`
based on whether the provider's display name looks like a real first + last name.
The heuristic (`looksLikeFullName`): trimmed name contains a space and has
length > 3. When the heuristic returns false, `onboarding_completed` is set to
false so the client-side onboarding gate (ticket 016) will collect the name.

## Acceptance Criteria

- [x] `looksLikeFullName(name)` helper exported from `sign-in.handler.ts`: returns
      true when the trimmed name contains at least one space and has length > 3.
- [x] `createWithAudit` call for new OAuth users uses `looksLikeFullName(displayName)`
      to determine `onboarding_completed` instead of always passing `false`.
- [x] Unit tests for `looksLikeFullName` covering: good name, single-word name,
      empty string, whitespace-only, null, undefined, boundary cases (≤3 / >3 chars).
- [x] Integration tests for each provider (Google, GitHub, Pike 13):
      good displayName → `onboarding_completed=true`;
      bad/missing displayName → `onboarding_completed=false`.
- [x] Returning-user test: `onboarding_completed` is not modified on sign-in
      (handler preserves the stored value).
- [x] All 78 sign-in.handler tests pass.

## Testing

- **Existing tests**: `tests/server/services/auth/sign-in.handler.test.ts`
- **New tests**: `looksLikeFullName` unit suite + `T013` integration describe block
  (7 per-provider and returning-user tests) appended to the same file.
- **Verification command**: `npm run test:server -- sign-in.handler`
