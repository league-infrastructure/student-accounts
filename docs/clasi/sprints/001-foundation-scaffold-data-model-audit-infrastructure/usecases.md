---
sprint: "001"
status: active
---

# Sprint 001 Use Cases

Sprint 001 delivers the data and infrastructure layer that every subsequent
sprint depends on. It fully delivers UC-021 (audit log recording). All other
use cases in the design are partially served: their entities are created and
their repositories are wired up, but the business logic, routes, and UI that
complete those use cases land in later sprints.

---

## SUC-001: Audit Event Recorded Atomically with Triggering Write
Parent: UC-021

- **Actor**: System (any service-layer call that performs a write)
- **Preconditions**:
  - A Prisma transaction is open for the triggering write.
  - The AuditEvent table exists in the database.
- **Main Flow**:
  1. Service method opens (or receives) a Prisma interactive transaction.
  2. Service method performs the primary write (insert/update/delete on any
     entity table) inside the transaction.
  3. Service method calls `AuditService.record(tx, event)` with the open
     transaction handle, passing actor, action string, target entity
     identifiers, and a JSON details payload.
  4. `AuditService.record` inserts an `AuditEvent` row inside the same
     transaction.
  5. Transaction commits. Both the primary write and the audit row land
     atomically.
- **Postconditions**:
  - An `AuditEvent` row exists whose `created_at` is within the same
    transaction as the triggering write.
  - If either write fails, both are rolled back — no partial state.
- **Acceptance Criteria**:
  - [ ] `AuditService.record` can be called inside any Prisma interactive
        transaction (accepts `tx` parameter of type `Prisma.TransactionClient`).
  - [ ] Integration test: a deliberate failure after the primary write but
        before commit rolls back the `AuditEvent` row.
  - [ ] Integration test: a successful write produces exactly one `AuditEvent`
        row with the correct `action`, `actor_user_id`, `target_entity_type`,
        `target_entity_id`, and non-null `created_at`.

---

## SUC-002: AuditEvent Table Accepts Required Fields and Enforces Schema
Parent: UC-021, UC-023

- **Actor**: System
- **Preconditions**:
  - Database migration for `AuditEvent` has been applied.
- **Main Flow**:
  1. A caller inserts an `AuditEvent` row with all required fields.
  2. Database accepts the row.
  3. A caller attempts to insert with `actor_user_id` = null (system action).
  4. Database accepts it (null is permitted).
  5. A caller attempts to insert with a missing required field (`action`).
  6. Database rejects it (NOT NULL constraint).
- **Postconditions**:
  - Only structurally valid `AuditEvent` rows exist in the table.
- **Acceptance Criteria**:
  - [ ] `actor_user_id` column allows NULL (system-initiated actions).
  - [ ] `action` column is NOT NULL.
  - [ ] `details` column accepts a JSON/JSONB value.
  - [ ] Index exists on `(target_user_id, created_at)` to support UC-023
        search queries.
  - [ ] Index exists on `(actor_user_id, created_at)`.
  - [ ] Index exists on `(action, created_at)`.

---

## SUC-003: All Seven Entity Tables Created with Correct Constraints
Parent: UC-001 through UC-023 (foundational)

- **Actor**: System (database migration runner)
- **Preconditions**:
  - Database is reachable (Postgres in CI and production; SQLite in local dev).
  - Prisma migrations have not yet been applied.
- **Main Flow**:
  1. Operator (or CI) runs `prisma migrate deploy`.
  2. Migrations apply in sequence: Cohort, User, Login, ExternalAccount,
     AuditEvent, ProvisioningRequest, MergeSuggestion.
  3. All foreign-key relationships are enforced.
  4. Unique constraints prevent duplicate records where specified.
- **Postconditions**:
  - All seven entity tables exist with correct columns, types, constraints,
    and indexes.
  - `_prisma_migrations` table records the applied migrations.
- **Acceptance Criteria**:
  - [ ] `User.primary_email` is UNIQUE.
  - [ ] `Login(provider, provider_user_id)` composite UNIQUE constraint
        prevents the same OAuth identity from attaching to two users.
  - [ ] `ExternalAccount(user_id, type)` with a partial unique index on
        `status IN ('pending','active')` prevents duplicate active accounts
        of the same type per user.
  - [ ] `User.cohort_id` is a nullable FK to `Cohort.id`.
  - [ ] `MergeSuggestion.user_a_id` and `user_b_id` are FKs to `User.id`.
  - [ ] `AuditEvent.actor_user_id` is a nullable FK to `User.id`.
  - [ ] `ProvisioningRequest.user_id` is a FK to `User.id`.

---

## SUC-004: Repository Layer Provides Typed CRUD for All Seven Entities
Parent: UC-001 through UC-023 (foundational)

- **Actor**: Service classes (called from route handlers and other services)
- **Preconditions**:
  - All seven tables exist.
  - A Prisma client (or transaction client) is available.
- **Main Flow**:
  1. A service imports the relevant repository class.
  2. Service calls repository methods (create, findById, findByXxx, update,
     delete, list) to read or write the entity.
  3. Repository translates the call into a Prisma query and returns the
     typed result.
- **Postconditions**:
  - Entity data is persisted or returned correctly.
- **Acceptance Criteria**:
  - [ ] Repository classes exist for: `UserRepository`, `LoginRepository`,
        `ExternalAccountRepository`, `CohortRepository`, `AuditEventRepository`,
        `ProvisioningRequestRepository`, `MergeSuggestionRepository`.
  - [ ] Each repository accepts a Prisma transaction client so callers can
        compose multiple repository calls inside one transaction.
  - [ ] Integration tests cover at least: create, findById (hit), findById
        (miss → null or throw), update, delete for each entity.
  - [ ] FK constraint violations surface as typed errors (not raw Prisma
        exceptions).

---

## SUC-005: Health-Check Endpoint Returns 200 When Database Is Reachable
Parent: (infrastructure — no design use case; supports all UCs)

- **Actor**: Load balancer, operator, CI
- **Preconditions**:
  - Server is running.
  - Database connection is configured.
- **Main Flow**:
  1. Caller sends `GET /api/health`.
  2. Server pings the database (e.g., `SELECT 1`).
  3. Server responds `200 { status: "ok", db: "ok" }`.
- **Postconditions**:
  - Caller knows the server and database are operational.
- **Acceptance Criteria**:
  - [ ] `GET /api/health` returns 200 when DB is reachable.
  - [ ] Response body includes `{ status: "ok" }` at minimum.
  - [ ] Test verifies the endpoint without mocking the database.

---

## What Is Out of Scope for Sprint 001

The following design use cases are **not delivered** in Sprint 001. Their
entities are created and repositories are wired up, but the business
logic, routes, and external integrations are deferred:

| Use Case | What's Deferred |
|---|---|
| UC-001, UC-002 | Social OAuth flows, session creation, merge trigger on login |
| UC-003 | Staff OU detection, staff role assignment at sign-in |
| UC-004 | Pike13 API client, sync logic |
| UC-005, UC-006 | Google Admin SDK integration, Claude Team API client |
| UC-007 | Student self-service routes and UI |
| UC-008 to UC-011 | Login add/remove routes |
| UC-012 to UC-014 | Cohort management routes, bulk operations |
| UC-015 to UC-017 | Individual and bulk suspend/remove |
| UC-018 | Merge scanner, Anthropic API client |
| UC-019 | Merge queue UI and approval workflow |
| UC-020 | Pike13 write-back |
| UC-022 | Staff read-only directory view |
| UC-023 | Audit log search UI and API |
