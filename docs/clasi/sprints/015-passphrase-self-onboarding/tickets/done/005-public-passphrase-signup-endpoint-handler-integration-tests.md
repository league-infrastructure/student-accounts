---
id: '005'
title: Public passphrase-signup endpoint + handler + integration tests
status: in-progress
use-cases:
- SUC-004
- SUC-005
- SUC-007
- SUC-008
depends-on:
- '003'
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 005 — Public passphrase-signup endpoint + handler + integration tests

## Description

Implement the student-facing signup endpoint. The route is public (no auth required), mounted before `requireAuth` middleware in `server/src/routes/auth.ts`. The bulk of the logic lives in a dedicated handler file to keep the route thin.

## Acceptance Criteria

### Route

- [x] `server/src/routes/auth/passphrase-signup.ts` created; exports an Express `Router` with `POST /` mounted at `/api/auth/passphrase-signup` via `server/src/app.ts`.
- [x] Route is mounted before any `requireAuth` middleware.

### Handler (`server/src/services/auth/passphrase-signup.handler.ts`)

- [x] Username validation: lowercase input, `^[a-z0-9._-]+$` after lowercasing, 2–32 chars. Returns `400 { error: 'Username must be 2–32 characters' }` or `400 { error: 'Invalid username format' }` on failure.
- [x] Passphrase lookup via `PassphraseService.findBySignupValue`; returns `401 { error: 'Invalid or expired passphrase' }` if null.
- [x] Username uniqueness pre-check against `User.username`; returns `409 { error: 'That username is already taken' }` if collision.
- [x] Derived `primary_email`:
  - Cohort scope: `<slug>@<cohort-domain>` using `displayNameToSlug` (same derivation as workspace provisioning at `server/src/services/workspace-provisioning.service.ts`).
  - Group scope: `<slug>.g<groupId>@signup.local`.
  - Email collision retry: up to 5 attempts with `-2`, `-3`, … suffix; 409 after 5 failures.
- [x] Prisma transaction creates:
  - `User` with `username`, `password_hash: hashPassword(passphrase)`, `display_name: username`, `primary_email`, `role: 'student'`, `approval_status: 'approved'`, `is_active: true`, `onboarding_completed: true`, `cohort_id: scope==='cohort' ? scope.id : null`.
  - `Login` with `provider: 'passphrase'`, `provider_user_id: '<scope>:<scopeId>:<username>'`.
- [x] Fail-soft side effects (each in its own try/catch, outside the main transaction):
  - Cohort scope: `workspaceProvisioning.provision(userId, actorId=userId)`.
  - `grantLlmProxy=true`: `llmProxyTokens.grant(userId, { expiresAt: +30 days, tokenLimit: 1_000_000 }, userId, { scope: 'single' })`.
  - Group scope: `groupService.addMember(groupId, userId, actorId=userId)`.
- [x] `req.session.userId = userId` set after the transaction.
- [x] `adminBus.notify('users')` and scope topic (`'cohorts'` or `'groups'`) fired.
- [x] Response: `200 { id, username, displayName, primaryEmail, cohort, workspace: { provisioned: boolean, ... }, llmProxy: { granted: boolean, ... } }`.

### Tests

- [x] `tests/server/routes/auth-passphrase-signup.test.ts` created and green:
  - Happy path — cohort scope: user created, session set, workspace provisioned, response contains correct fields.
  - Happy path — group scope: user created, session set, user added to group, no workspace.
  - `grantLlmProxy=true` — LLM proxy token minted; present in response.
  - Expired passphrase → 401.
  - Revoked passphrase (null fields) → 401.
  - Username collision → 409.
  - Invalid username format → 400.
  - Workspace provision failure → 200 with `workspace.provisioned=false` (partial success; user still created).
  - After signup, the same `username + passphrase` authenticates successfully against `POST /api/auth/login` — deferred to ticket 006 per brief.
- [x] `npm run test:server` passes with the new suite included (1386 total; +14 from this ticket).
- [x] `npx tsc --noEmit` in `server/` shows no new errors (pre-existing errors only).

## Implementation Plan

### Approach

Route file is thin: parse body, call handler, return response. Handler owns all validation and orchestration. Fail-soft side effects are wrapped individually — no single downstream failure should roll back account creation.

### Files to Create

- `server/src/routes/auth/passphrase-signup.ts`
- `server/src/services/auth/passphrase-signup.handler.ts`
- `tests/server/routes/auth-passphrase-signup.test.ts`

### Files to Modify

- `server/src/routes/auth.ts` — mount `passphrase-signup` router at `/api/auth/passphrase-signup`.

### Testing Plan

- Full integration suite as described.
- The last test case (login round-trip) requires that Ticket 006 `POST /api/auth/login` is accessible — coordinate test setup so the login route is also mounted in the test server, or defer that specific case to Ticket 006's test file.
- Run `npm run test:server` and `npx tsc --noEmit` in `server/`.

### Documentation Updates

None.
