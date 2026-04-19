---
id: '005'
title: "CohortService.createWithOU \u2014 transactional Admin SDK createOU + Cohort\
  \ row + audit"
status: done
use-cases:
- UC-012
depends-on:
- '001'
- '002'
github-issue: ''
todo: ''
---

# CohortService.createWithOU — transactional Admin SDK createOU + Cohort row + audit

## Description

This ticket implements UC-012: admin creates a cohort. A new method
`createWithOU(name, actorId)` is added to the existing `CohortService`.

The method must:
1. Validate the name (non-blank, not already used by an existing Cohort).
2. Call `GoogleWorkspaceAdminClient.createOU(name)` — creates the child OU
   under `GOOGLE_STUDENT_OU_ROOT`.
3. Open a `prisma.$transaction` and call `CohortRepository.create({ name, google_ou_path })`.
4. Record the `create_cohort` AuditEvent inside the same transaction.
5. If the Prisma write fails after the OU was created, the transaction is
   rolled back but the OU remains (documented edge case in architecture doc —
   retry path should handle "OU already exists" gracefully).

`CohortService` must receive `GoogleWorkspaceAdminClient` as a new constructor
dependency.

## Acceptance Criteria

- [x] Method `createWithOU(name: string, actorId: number): Promise<Cohort>` is
      added to `CohortService`.
- [x] Name is validated before any API call:
      - Not blank (throws `ValidationError`).
      - Not a duplicate of an existing Cohort name (throws `ConflictError`).
- [x] Calls `googleClient.createOU(name)`. The returned `ouPath` is used as
      `google_ou_path` on the Cohort record.
- [x] If `createOU` throws, no Cohort row is created (function throws the
      error to the caller).
- [x] On `createOU` success, opens `prisma.$transaction`:
      - `CohortRepository.create(tx, { name, google_ou_path: createdOU.ouPath })`.
      - `AuditService.record(tx, { action: 'create_cohort', actor_user_id: actorId,
        target_entity_type: 'Cohort', target_entity_id: String(cohort.id),
        details: { name, google_ou_path } })`.
      - Returns the created Cohort.
- [x] If the Prisma write fails (e.g., race condition on name uniqueness after
      the earlier check): the transaction is rolled back; the function throws.
      The OU may already exist in Google — this is documented behavior.
- [x] `CohortService` constructor updated to accept
      `googleClient: GoogleWorkspaceAdminClient` (optional parameter, defaults
      to undefined for Sprint 001 compatibility, but required for `createWithOU`).
- [x] `ServiceRegistry` updated to pass `GoogleWorkspaceAdminClient` to
      `CohortService`.
- [x] Existing `CohortService` tests (Sprint 001 findAll, findById, etc.)
      still pass — they use a cohort that already has `google_ou_path` set
      (or null) and do not call `createWithOU`.
- [x] `npm test` passes.

## Implementation Plan

### Approach

Add the method to the existing service class. The Google client is injected
as a new constructor parameter (nullable / optional for backward compatibility
with existing tests that instantiate `CohortService` without it). `createWithOU`
checks the client is present and throws a configuration error if it is not.

### Files to Modify

- `server/src/services/cohort.service.ts` — add `createWithOU`, update
  constructor.
- `server/src/services/service.registry.ts` — pass `GoogleWorkspaceAdminClient`
  to `CohortService`.

### Testing Plan

Integration tests for `CohortService.createWithOU` are in T010 (cross-cutting
UC-012 test). This ticket's tests are unit-level, using
`FakeGoogleWorkspaceAdminClient`:

- `createWithOU` success: OU created with correct name, Cohort row exists with
  correct `google_ou_path`, AuditEvent written.
- `createWithOU` with blank name: throws `ValidationError`, no API call made.
- `createWithOU` with duplicate name: throws `ConflictError`, no API call made.
- `createWithOU` when `createOU` throws: no Cohort row created.

### Documentation Updates

None beyond the architecture-update.md.
