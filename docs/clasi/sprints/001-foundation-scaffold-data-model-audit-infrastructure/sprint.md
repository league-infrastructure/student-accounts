---
id: "001"
title: "Foundation — Scaffold, Data Model, Audit Infrastructure"
status: ticketing
branch: sprint/001-foundation-scaffold-data-model-audit-infrastructure
use-cases: [UC-021]
---

# Sprint 001: Foundation — Scaffold, Data Model, Audit Infrastructure

## Goal

Stand up the project skeleton and complete data model so every subsequent
sprint builds on a stable, tested foundation. The audit service is delivered
here because it is cross-cutting — every later sprint calls it without
ceremony.

## Use Cases Delivered

- **UC-021** — Audit log recording infrastructure (service layer and
  transaction semantics; the admin UI that queries it lands in Sprint 009).

All other use cases depend on entities created here but are not themselves
delivered.

## Scope

- Web framework (Node + Express), environment config, health-check endpoint.
- Database setup: SQLite for development, Postgres adapter for production.
- Schema migrations for all seven entities: `User`, `Login`,
  `ExternalAccount`, `Cohort`, `MergeSuggestion`, `AuditEvent`,
  `ProvisioningRequest`.
- Audit service module: creates `AuditEvent` records atomically within the
  triggering transaction; rolls back the triggering action if the audit write
  fails (UC-021 requirement).
- Test infrastructure: runner, database fixture helpers, unit and integration
  test patterns.
- CI baseline: lint + tests pass.

## Dependencies

- None — this is the root sprint.
- External: rundbat `create_environment` for the dev database.

## Non-Goals

- No authentication, OAuth, or any UI.
- No external integration clients (Google, Pike13, Claude Team, Anthropic).
- No business logic beyond schema constraints and the audit service.

## Rationale

Every use case in the system writes audit events and touches one or more of
these entities. Building the full schema in one sprint avoids retroactive
migrations in every subsequent sprint. The audit service is the one
cross-cutting piece that must be production-quality from the start — wiring
it in after the fact across many action handlers is error-prone.

## Tickets

Execution is serialised: each group must complete before the next begins.
Within a group, tickets are independent and can run in parallel if the
executor supports it.

### Group 1 — Scaffold and DB wiring (no domain schema yet)

| # | Title | Depends on |
|---|---|---|
| T001 | Project scaffold — adapt template for domain, remove demo features | — |
| T002 | Database connection — Prisma adapter auto-selects SQLite vs Postgres | T001 |

### Group 2 — Schema migrations (must apply in sequence)

| # | Title | Depends on |
|---|---|---|
| T003 | Migration — Cohort and User entities | T002 |
| T004 | Migration — Login and ExternalAccount entities | T003 |
| T005 | Migration — AuditEvent, ProvisioningRequest, MergeSuggestion | T004 |

### Group 3 — Repository + service layer (builds on complete schema)

| # | Title | Depends on |
|---|---|---|
| T006 | Repository layer — typed CRUD for all 7 entities | T005 |
| T007 | AuditService — atomic write pattern with transaction tests | T006 |
| T008 | Service layer — domain services, ServiceRegistry, factories | T007 |

### Group 4 — Integration gate

| # | Title | Depends on |
|---|---|---|
| T009 | Health-check endpoint + CI skeleton | T008 |
