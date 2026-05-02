---
id: '004'
title: "Server \u2014 admin shared-pool invariant tests"
status: done
use-cases:
- SUC-023-005
depends-on:
- 023-001
- 023-002
github-issue: ''
todo: ''
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server — admin shared-pool invariant tests

## Description

Sprint 020 established the admin shared-pool model: any admin can view, edit,
rotate, and delete any other admin's OAuth client. This is already implemented
via `enforceOwnership` in `OAuthClientService` (admins bypass the owner check),
but no test explicitly asserts the admin-A-mutates-admin-B scenario. Without a
regression test, this invariant is invisible — a future refactor could break it
silently.

This ticket adds explicit tests for the admin shared-pool invariant. It depends
on 001 and 002 because those tickets add `actor` context to the `create` path,
which these tests rely on.

## Acceptance Criteria

- [x] A test verifies that Admin A can `list` and see Admin B's client.
- [x] A test verifies that Admin A can `update` Admin B's client (name/description change) → success.
- [x] A test verifies that Admin A can `rotateSecret` on Admin B's client → success.
- [x] A test verifies that Admin A can `disable` Admin B's client → success.
- [x] A test verifies that a student cannot `update` another student's client → 403.
- [x] A test verifies that a staff user cannot `update` another user's client → 403.
- [x] All new tests are in `tests/server/routes/oauth-clients.test.ts` (or the service unit test file — wherever the existing ownership tests live).

## Implementation Plan

### Approach

These are purely additive tests — no production code changes. The
`enforceOwnership` private method in `OAuthClientService` already handles
the admin bypass; the tests just confirm it holds.

The test setup creates two admin users (Admin A and Admin B), creates a client
as Admin B, then performs mutations as Admin A via the Supertest request helper.

### Files to Modify

- `tests/server/routes/oauth-clients.test.ts`:
  - Add a `describe('admin shared-pool invariant')` block with the tests above.
  - Reuse existing test helpers (user creation, session login, client creation).

### Testing Plan

Run `npm run test:server` after adding the tests.

Specifically:
- `adminA.patch('/api/oauth-clients/:id').send({name:'changed'})` where `id` belongs to `adminB` → expect 200.
- `adminA.post('/api/oauth-clients/:id/rotate-secret')` → expect 200.
- `adminA.delete('/api/oauth-clients/:id')` → expect 204.
- `student.patch('/api/oauth-clients/:otherId')` → expect 403.

### Documentation Updates

None — the invariant is documented in the architecture update and use cases.
