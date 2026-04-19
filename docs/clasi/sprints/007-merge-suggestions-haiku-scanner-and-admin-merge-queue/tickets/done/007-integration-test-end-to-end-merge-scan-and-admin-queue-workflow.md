---
id: "007"
title: "Integration test — end-to-end merge scan and admin queue workflow"
status: done
use-cases: [SUC-007-001, SUC-007-002, SUC-007-003, SUC-007-004]
depends-on: ["003", "005"]
github-issue: ""
todo: ""
---

# Integration test — end-to-end merge scan and admin queue workflow

## Description

Write end-to-end integration tests that exercise the full merge workflow from
scan to admin action. These tests use a real SQLite test database and a fake
`HaikuClient` (no live Anthropic API calls). They validate the wiring between
`MergeScanService`, `MergeSuggestionService`, the admin routes, and the database.

These tests are separate from the unit tests written in T002, T003, and T004.
They verify the complete pipeline works together.

## Acceptance Criteria

- [x] Test: Simulate user creation → `mergeScan` called with fake HaikuClient
      returning confidence 0.8 → `MergeSuggestion` row created with correct
      user_a_id, user_b_id, haiku_confidence.
- [x] Test: Simulate user creation → fake HaikuClient returns confidence 0.4 →
      no `MergeSuggestion` row created.
- [x] Test: `GET /admin/merge-queue` returns the suggestion from the first test.
- [x] Test: `GET /admin/merge-queue/:id` returns full detail including User A
      Logins and ExternalAccounts.
- [x] Test: `POST /admin/merge-queue/:id/approve` → verify survivor has all
      Logins, non-survivor has `is_active=false`, suggestion `status=approved`.
- [x] Test: `POST /admin/merge-queue/:id/approve` with duplicate Login →
      transaction rolls back; both users intact.
- [x] Test: `POST /admin/merge-queue/:id/reject` → suggestion `status=rejected`.
- [x] Test: `POST /admin/merge-queue/:id/defer` → suggestion `status=deferred`;
      suggestion appears in `GET /admin/merge-queue`.
- [x] All integration tests pass with `npm run test:server`.

## Implementation Plan

### Approach

1. Create `tests/server/admin/merge-workflow.integration.test.ts`.
2. Use the project's existing test DB setup (SQLite in-memory or file, with
   `ServiceRegistry.clearAll()` between tests).
3. Use `jest.mock` or dependency injection to inject a fake `HaikuClient` that
   returns controlled `{ confidence, rationale }` responses.
4. Use `supertest` with the Express app for the HTTP-layer assertions.
5. Assert database state directly via `ServiceRegistry.prisma` after each action.

### Files to Create/Modify

- `tests/server/admin/merge-workflow.integration.test.ts` — new

### Testing Plan

This ticket IS the testing ticket. Run via `npm run test:server`.

### Documentation Updates

None required.
