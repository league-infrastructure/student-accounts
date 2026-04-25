---
id: '003'
title: PassphraseService + ServiceRegistry wiring + service tests
status: todo
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
  - SUC-007
  - SUC-008
depends-on:
  - '002'
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 003 — PassphraseService + ServiceRegistry wiring + service tests

## Description

Implement the `PassphraseService` class — the single point of truth for passphrase lifecycle — and wire it into the existing `ServiceRegistry`. All admin route handlers (Ticket 004) and the signup handler (Ticket 005) depend on this service.

## Acceptance Criteria

### PassphraseService

- [ ] File created at `server/src/services/passphrase.service.ts`.
- [ ] Exports `PassphraseService` class with the polymorphic `Scope` type:
  ```ts
  type Scope = { kind: 'group' | 'cohort'; id: number }
  ```
- [ ] `create(scope, opts: { plaintext?: string; grantLlmProxy: boolean }, actorId: number)`:
  - Generates a passphrase if `plaintext` is not supplied (calls `generatePassphrase`).
  - Validates the shape with `validatePassphraseShape`.
  - Checks for collision: if any other active (non-expired) Group or Cohort row has the same `signup_passphrase`, regenerates (up to 10 attempts) then throws if still colliding.
  - Sets `signup_passphrase`, `signup_passphrase_grant_llm_proxy`, `signup_passphrase_expires_at` (now + 1 hour), `signup_passphrase_created_at` (now), `signup_passphrase_created_by` (actorId) on the target row.
  - Writes a `create_signup_passphrase` audit event inside the Prisma transaction.
  - Returns `{ plaintext, expiresAt, grantLlmProxy }`.
- [ ] `revoke(scope, actorId: number)`:
  - Clears all five passphrase fields on the target row (sets to null / false).
  - Writes a `revoke_signup_passphrase` audit event inside the transaction.
- [ ] `getActive(scope)`:
  - Returns `{ plaintext, expiresAt, grantLlmProxy }` if an active (non-expired) passphrase exists.
  - Returns `null` if no passphrase or expired.
- [ ] `findBySignupValue(plaintext: string)`:
  - Scans all Group and Cohort rows for a matching `signup_passphrase`.
  - Returns `{ scope: 'group' | 'cohort'; id: number; grantLlmProxy: boolean }` if found and not expired.
  - Returns `null` if not found or expired.

### ServiceRegistry

- [ ] `server/src/services/service.registry.ts` registers `passphrases: new PassphraseService(prisma)` (or however the registry wires services).
- [ ] Existing services are unchanged; no circular imports introduced.

### Tests

- [ ] `tests/server/services/passphrase.service.test.ts` created and green:
  - `create` with no plaintext generates a valid phrase and persists it.
  - `create` with explicit plaintext persists that value.
  - `create` returns the plaintext and correct `expiresAt` (~1 hour from now).
  - `create` rotation: calling create on a scope that already has a passphrase overwrites it (one active passphrase per scope).
  - `revoke` clears all fields; subsequent `getActive` returns null.
  - `getActive` returns null for a scope with no passphrase.
  - `getActive` returns null for an expired passphrase (set `expires_at` to past).
  - `findBySignupValue` returns the scope info for an active passphrase.
  - `findBySignupValue` returns null for an expired passphrase.
  - `findBySignupValue` returns null for an unknown string.
  - Collision detection: if two scopes would have the same passphrase, `create` regenerates.
  - Audit events `create_signup_passphrase` and `revoke_signup_passphrase` are written.
- [ ] `npm run test:server` passes with the new suite included.
- [ ] `npx tsc --noEmit` in `server/` shows no new errors.

## Implementation Plan

### Approach

Model the service on existing services like `GroupService` — constructor takes `prisma`, methods wrap Prisma calls in transactions, audit events use the existing audit helper. The `Scope` discriminated union keeps the group and cohort code paths DRY.

### Files to Create

- `server/src/services/passphrase.service.ts`
- `tests/server/services/passphrase.service.test.ts`

### Files to Modify

- `server/src/services/service.registry.ts` — add `passphrases` slot.

### Testing Plan

- Comprehensive service tests as described above.
- Tests should use an in-memory SQLite test DB consistent with the existing test harness.
- Run `npm run test:server` and `npx tsc --noEmit` in `server/`.

### Documentation Updates

None beyond inline JSDoc on the public methods.
