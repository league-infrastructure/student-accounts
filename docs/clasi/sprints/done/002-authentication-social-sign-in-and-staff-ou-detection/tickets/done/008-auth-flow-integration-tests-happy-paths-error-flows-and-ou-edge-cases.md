---
id: 008
title: "Auth flow integration tests \u2014 happy paths, error flows, and OU edge cases"
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '003'
- '005'
- '006'
- '007'
github-issue: ''
todo: ''
---

# T008: Auth flow integration tests — happy paths, error flows, and OU edge cases

## Description

Consolidate and complete the integration test suite for the entire Sprint 002
auth layer. Earlier tickets (T002, T003, T005) each wrote tests incrementally;
this ticket ensures full scenario coverage, fills any gaps, and verifies the
complete system working together: OAuth strategies + sign-in handler + session
+ middleware + DB writes + audit events.

All OAuth interactions use mock Passport strategies and `FakeAdminDirectoryClient`.
Tests run against a real SQLite database (same as Sprint 001 pattern).

## Acceptance Criteria

Each row in the table below maps to one or more test cases. All must pass.

| Scenario | Expected outcome |
|---|---|
| Google OAuth: new user | User + Login created; AuditEvents written; session has userId + role=student |
| Google OAuth: returning user | No new records; session established for existing User |
| Google OAuth: oauth error/denied | No records; redirect to `/?error=oauth_denied` |
| Google OAuth: `@jointheleague.org` + in staff OU | role=staff in DB + session |
| Google OAuth: `@jointheleague.org` + not in staff OU | role=student |
| Google OAuth: `@jointheleague.org` + Admin SDK failure | 403 / error redirect; no session |
| Google OAuth: `@students.jointheleague.org` | OU check skipped; role=student |
| Google OAuth: other domain | OU check skipped; role=student |
| GitHub OAuth: new user | User + Login created; provider_username stored |
| GitHub OAuth: returning user | No new records; session established |
| GitHub OAuth: oauth error/denied | No records; redirect to error |
| GitHub OAuth: no public email | User created with placeholder primary_email |
| Duplicate Login (ConflictError) | Session established for existing User; no new records |
| Logout | Session destroyed; redirect to sign-in page |
| requireAuth: no session | 401 |
| requireRole: wrong role | 403 |
| mergeScan stub called for new users | Log message verified |
| mergeScan stub not called for returning users | Not logged |

- [x] All 18+ scenarios have passing tests.
- [x] Tests use real SQLite database (not mocked).
- [x] `FakeAdminDirectoryClient` used for all OU tests.
- [x] `MockGoogleStrategy` and `MockGitHubStrategy` are in shared test helper.
- [x] `npm run test:server` passes with the full suite.

## Implementation Plan

### Approach

This is a pure test-writing ticket. Review all tests written in T002–T007,
identify gaps against the coverage table above, and write the missing cases.
Refactor any scattered helpers into a single
`tests/server/helpers/auth-test-helpers.ts` module to avoid duplication.

### Files to Create

- `tests/server/helpers/passport-test-setup.ts` (may already exist from T002)
  — `MockGoogleStrategy`, `MockGitHubStrategy`, `FakeAdminDirectoryClient`.
- `tests/server/helpers/auth-test-helpers.ts` — shared session injection,
  user/login factory shortcuts.
- `tests/server/routes/auth.integration.test.ts` — comprehensive scenario
  coverage if not already split across T002/T003/T005 test files.

### Files to Modify

- Existing auth test files from T002–T007 — fill gaps, remove duplication.

### Testing Plan

This ticket is itself a testing ticket. The acceptance criteria are the test
plan. Verify by running `npm run test:server` and confirming all scenarios pass.

### Documentation Updates

None.
