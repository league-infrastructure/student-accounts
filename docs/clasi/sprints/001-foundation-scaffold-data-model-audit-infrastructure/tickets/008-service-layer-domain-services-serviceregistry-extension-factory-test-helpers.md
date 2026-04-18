---
id: 008
title: "Service layer \u2014 domain services, ServiceRegistry extension, factory test\
  \ helpers"
status: in-progress
use-cases:
- SUC-004
depends-on:
- '007'
github-issue: ''
todo: ''
---

# Service layer — domain services, ServiceRegistry extension, factory test helpers

## Description

Create the domain service classes for Cohort, Login, ExternalAccount, and
the stub services for ProvisioningRequest and MergeSuggestion. Fully rewrite
`UserService` to work with the new domain schema. Wire all services into
`ServiceRegistry`. Also update `tests/server/global-setup.ts` to ensure the
new entity tables are cleanly truncated between test runs.

This ticket does not add business logic for external API integrations (Google,
Claude Team, Pike13, Anthropic) — those land in later sprints. Services in
this ticket cover only: in-database CRUD, constraint enforcement, and audit
event recording for actions that produce audit events without external calls.

## Acceptance Criteria

- [x] `server/src/services/user.service.ts` is fully rewritten for the
      domain schema. It provides at minimum:
      - `createWithAudit(data, actorId?)` — creates User + records
        `create_user` AuditEvent in one transaction (pattern from T007).
      - `findById(id)` — returns User or throws NotFoundError.
      - `findByEmail(email)` — returns User or null.
      - `findAll(filters?: { role?, cohort_id? })` — returns User[].
      - `updateCohort(userId, cohortId, actorId)` — updates cohort +
        records `assign_cohort` AuditEvent.
      - `delete(userId)` — deletes User. The DB enforces `onDelete: Restrict`
        on Login and ExternalAccount FKs; the service must verify no Login or
        ExternalAccount rows remain before calling the delete, or propagate
        the DB constraint error as a domain error (stakeholder decision,
        2026-04-18).

- [x] `server/src/services/cohort.service.ts` provides:
      - `create(data)` — creates Cohort record (no Google API call in this
        sprint; that's a later sprint).
      - `findById(id)` — returns Cohort or throws NotFoundError.
      - `findAll()` — returns Cohort[].
      - `findByName(name)` — returns Cohort or null.

- [x] `server/src/services/login.service.ts` provides:
      - `create(userId, provider, providerUserId, providerEmail?)` — creates
        Login; throws ConflictError if `(provider, provider_user_id)` already
        exists on any User.
      - `findByProvider(provider, providerUserId)` — returns Login or null.
      - `findAllByUser(userId)` — returns Login[].
      - `delete(loginId, actorId)` — deletes Login; throws ValidationError if
        it would leave the User with zero Logins.

- [x] `server/src/services/external-account.service.ts` provides:
      - `create(userId, type, externalId?)` — creates ExternalAccount in
        pending status; throws ConflictError if an active/pending account of
        the same type already exists for this user.
      - `findAllByUser(userId)` — returns ExternalAccount[].
      - `findActiveByUserAndType(userId, type)` — returns ExternalAccount
        or null.
      - `updateStatus(accountId, status, actorId)` — updates status +
        records appropriate AuditEvent (`suspend_workspace`, etc.).

- [x] Stub service classes exist for `ProvisioningRequest` and
      `MergeSuggestion` — just enough to instantiate without errors.
      Business logic methods (approve, reject, defer) are deferred.

- [x] `ServiceRegistry` is updated to include all new service instances:
      `users`, `cohorts`, `logins`, `externalAccounts`, `provisioningRequests`,
      `mergeSuggestions`, `audit`.

- [x] `tests/server/global-setup.ts` truncates all 7 domain entity tables
      (verify the existing dynamic introspection covers the new tables, or
      add them explicitly).

- [x] `npm run test:server` passes all repository tests from T006, audit
      service tests from T007, and any new service-level tests written here.

## Implementation Plan

### File Creation

- `server/src/services/cohort.service.ts`
- `server/src/services/login.service.ts`
- `server/src/services/external-account.service.ts`
- `server/src/services/provisioning-request.service.ts` (stub)
- `server/src/services/merge-suggestion.service.ts` (stub)

### Files to Modify

- `server/src/services/user.service.ts` — full rewrite.
- `server/src/services/service.registry.ts` — add all new services.
- `tests/server/global-setup.ts` — confirm table truncation covers new tables.

### Service Constructor Pattern

Domain services receive the shared Prisma client and the `AuditService`
instance via constructor. `ServiceRegistry` passes them:

```typescript
class UserService {
  constructor(
    private prisma: PrismaClient,
    private audit: AuditService
  ) {}
}
// In ServiceRegistry:
this.audit = new AuditService();
this.users = new UserService(defaultPrisma, this.audit);
```

### ExternalAccountService Action String Mapping

When calling `audit.record` after a status change, map the new status to
the correct action string:
- `suspended` + type=`workspace` → `suspend_workspace`
- `suspended` + type=`claude` → `suspend_claude`
- `removed` + type=`workspace` → `remove_workspace`
- `removed` + type=`claude` → `remove_claude`

### Testing Plan

Service-layer tests are optional in this ticket — the acceptance criteria
focus on the services compiling and being wired correctly, with the
repository tests from T006 providing the database-level coverage. If time
allows, add `tests/server/services/user.service.test.ts` covering at least
`createWithAudit` and `updateCohort`.

Verification: `npm run test:server` — all tests from T006 and T007 continue
to pass.

### Documentation Updates

None. The architecture document specifies the service responsibilities.
