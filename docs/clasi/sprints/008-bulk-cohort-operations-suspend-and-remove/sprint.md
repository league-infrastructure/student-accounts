---
id: "008"
title: "Bulk Cohort Operations — Suspend and Remove"
status: roadmap
branch: sprint/008-bulk-cohort-operations-suspend-and-remove
use-cases: [UC-013, UC-014]
---

# Sprint 008: Bulk Cohort Operations — Suspend and Remove

## Goal

Add cohort-level bulk actions so administrators can suspend or remove all
Workspace accounts or Claude seats for an entire cohort in a single
confirmed operation — the key end-of-term workflow.

## Use Cases Delivered

- **UC-013** — Cohort bulk suspend: suspend all Claude seats or all Workspace
  accounts for a cohort; confirmation dialog with affected count; per-account
  API call with collected error reporting; one AuditEvent per suspended
  account.
- **UC-014** — Cohort bulk remove: remove all Claude seats or all Workspace
  accounts for a cohort; Workspace follows suspend-then-schedule-delete-in-3-
  days; Claude seats released immediately; confirmation dialog with irreversible
  warning; one AuditEvent per removed account.

## Scope

- Bulk action UI on the cohort detail page: action selector (suspend Workspace,
  suspend Claude, remove Workspace, remove Claude), confirmation dialog showing
  affected count.
- Bulk execution service: iterates all Users in the cohort with applicable
  active ExternalAccounts, calls the existing single-account suspend/remove
  service methods from Sprint 005 in sequence.
- Error handling: partial failures collected and reported after the batch;
  successful operations not rolled back.
- Audit events per account (not per cohort) so the log remains searchable by
  individual student.
- List-users-in-OU call to the Google Admin SDK for cohort membership
  reconciliation (if needed for accuracy beyond DB query).

## Dependencies

- Sprint 001 (data model, audit service).
- Sprint 002 (auth).
- Sprint 004 (Cohort and OU model; cohort management UI to add bulk actions to).
- Sprint 005 (individual suspend/remove service methods reused here).
- External: Google Admin SDK and Claude Team API (same credentials as Sprints
  004 and 005).

## Non-Goals

- No bulk provisioning (individual provisioning only, per design).
- No scheduled/automatic suspension — administrator-triggered only.
- No bulk operations on Pike13 or GitHub records (spec non-goal).

## Rationale

Bulk operations are deliberately placed after all individual account
lifecycle operations are complete. They reuse the same service-layer methods
from Sprint 005 and only add the iteration + confirmation layer. Separating
them keeps Sprints 004 and 005 focused on correctness of the single-account
path before the bulk path amplifies any bugs across an entire cohort.

## Tickets

_(To be created when this sprint enters Detail Mode.)_
