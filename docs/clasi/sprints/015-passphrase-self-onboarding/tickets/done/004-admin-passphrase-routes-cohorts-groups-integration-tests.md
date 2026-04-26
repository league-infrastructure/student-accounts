---
id: '004'
title: Admin passphrase routes (cohorts + groups) + integration tests
status: in-progress
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '003'
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 004 — Admin passphrase routes (cohorts + groups) + integration tests

## Description

Add three route handlers each to the existing `admin/cohorts.ts` and `admin/groups.ts` routers: create, get, and revoke a passphrase. These are the admin-facing endpoints that power the `PassphraseModal` and the passphrase card (Ticket 007). The public signup and login endpoints are separate (Tickets 005, 006).

## Acceptance Criteria

### Cohort passphrase routes (in `server/src/routes/admin/cohorts.ts`)

- [x] `POST /admin/cohorts/:id/passphrase`
  - Requires admin auth.
  - Body: `{ plaintext?: string; grantLlmProxy: boolean }`.
  - Calls `PassphraseService.create({ kind: 'cohort', id }, opts, actorId)`.
  - Returns `200 { plaintext, expiresAt, grantLlmProxy }`.
  - Returns `404` if cohort not found.
  - Fires `adminBus.notify('cohorts')` on success.
- [x] `GET /admin/cohorts/:id/passphrase`
  - Requires admin auth.
  - Calls `PassphraseService.getActive({ kind: 'cohort', id })`.
  - Returns `200 { plaintext, expiresAt, grantLlmProxy }` or `404` if none/expired.
- [x] `DELETE /admin/cohorts/:id/passphrase`
  - Requires admin auth.
  - Calls `PassphraseService.revoke({ kind: 'cohort', id }, actorId)`.
  - Returns `204` on success.
  - Fires `adminBus.notify('cohorts')` on success.

### Group passphrase routes (in `server/src/routes/admin/groups.ts`)

- [x] `POST /admin/groups/:id/passphrase` — identical semantics, fires `adminBus.notify('groups')`.
- [x] `GET /admin/groups/:id/passphrase` — identical semantics.
- [x] `DELETE /admin/groups/:id/passphrase` — identical semantics, fires `adminBus.notify('groups')`.

### Tests

- [x] `tests/server/routes/admin-passphrase.test.ts` created and green, covering all six routes:
  - POST cohort: creates passphrase, returns plaintext + expiresAt.
  - GET cohort: returns active passphrase; 404 when none.
  - DELETE cohort: revokes; subsequent GET returns 404.
  - POST group: same.
  - GET group: same.
  - DELETE group: same.
  - All six routes return 401 when called without admin auth.
  - POST with an explicit `plaintext` value persists that value.
- [x] `npm run test:server` passes with the new suite included.
- [x] `npx tsc --noEmit` in `server/` shows no new errors.

## Implementation Plan

### Approach

Extend the existing route files with new handler functions — do not create new router files. Pattern after existing handlers in those files (auth middleware, Prisma error handling, 404 guards). The service does all the business logic; the handlers are thin.

### Files to Modify

- `server/src/routes/admin/cohorts.ts` — add three handlers.
- `server/src/routes/admin/groups.ts` — add three handlers.

### Files to Create

- `tests/server/routes/admin-passphrase.test.ts`

### Testing Plan

- Integration tests covering all six endpoints with auth and without.
- Run `npm run test:server` and `npx tsc --noEmit` in `server/`.

### Documentation Updates

None.
