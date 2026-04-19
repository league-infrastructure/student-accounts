---
id: "004"
title: "Google Workspace Integration — Cohort OUs and Workspace Provisioning"
status: planning
branch: sprint/004-google-workspace-integration-cohort-ous-and-workspace-provisioning
use-cases: [UC-005, UC-012]
---

# Sprint 004: Google Workspace Integration — Cohort OUs and Workspace Provisioning

## Goal

Wire the Google Admin SDK for the two operations that must exist before any
other provisioning can happen: cohort creation (which creates the OU) and
individual League Workspace account provisioning.

## Use Cases Delivered

- **UC-012** — Admin creates a cohort: creates the Google OU as a child of
  the student OU root; stores `google_ou_path` on the Cohort record.
- **UC-005** — Admin provisions a League Workspace account: calls Admin SDK
  to create a `@students.jointheleague.org` user in the cohort OU; sets
  `sendNotificationEmail`; creates the `ExternalAccount` record; writes back
  to Pike13 if linked (the write-back client is stubbed — Sprint 006 fills it
  in).

## Scope

- Google Admin SDK client module: create user, suspend user (future), delete
  user (future), create OU, list users in OU (future), read staff OU
  membership (already wired in Sprint 002 — same client reused).
- Domain restriction guard in the SDK client: refuse any attempt to create
  accounts outside `@students.jointheleague.org` or outside a student cohort
  OU. Hard block at the integration layer.
- Cohort management UI (admin): list cohorts, create cohort form.
- User detail view (admin): "Provision League Workspace Account" button with
  pre-condition checks (student role, cohort assigned, no existing active
  workspace account).
- ExternalAccount record creation on success; error surfacing on API failure.
- Audit events for create_cohort and provision_workspace.
- Pike13 write-back call site: call the write-back function if present;
  stub returns no-op until Sprint 006.

## Dependencies

- Sprint 001 (data model, audit service).
- Sprint 002 (auth — admin must be signed in).
- External: Google Admin SDK service account credentials with domain-wide
  delegation; student OU root path configured.

## Non-Goals

- No Claude Team provisioning (Sprint 005).
- No bulk cohort operations (Sprint 008).
- No suspend or delete of Workspace accounts (Sprint 005 handles individual
  lifecycle; Sprint 008 handles bulk).
- Pike13 write-back is a stub here; real implementation is Sprint 006.

## Rationale

Cohort creation and Workspace provisioning are tightly coupled — a cohort
must exist (and its OU must exist) before any Workspace account can be
created. Grouping them avoids splitting a single SDK client across two
sprints. Claude Team is deliberately deferred because it depends on the
Workspace account existing, and adding it here would over-load the sprint.

## Tickets

| # | Title | Depends On |
|---|---|---|
| 001 | Extend GoogleAdminDirectoryClient to GoogleWorkspaceAdminClient with write methods and Fake | — |
| 002 | Write-enable flag and domain/OU guard in GoogleWorkspaceAdminClient | 001 |
| 003 | Pike13 write-back stub seam — no-op module at stable import path | — |
| 004 | WorkspaceProvisioningService — provision with precondition checks, ExternalAccount creation, and audit | 001, 002, 003 |
| 005 | CohortService.createWithOU — transactional Admin SDK createOU + Cohort row + audit | 001, 002 |
| 006 | Admin role assignment — ADMIN_EMAILS env var check in sign-in handler | 001 |
| 007 | ProvisioningRequestService.approve wired to WorkspaceProvisioningService — approval triggers provision | 004 |
| 008 | Admin provisioning-requests page — list pending, approve, and reject actions (API + UI) | 006, 007 |
| 009 | Admin cohort management page — list cohorts and create cohort form (API + UI) | 005, 006 |
| 010 | Integration tests — UC-005 and UC-012 cross-cutting with FakeGoogleWorkspaceAdminClient | 004, 005, 007, 008, 009 |

### Parallel Execution Groups

**Group 1** (no dependencies — can run in parallel):
- T001 — Extend client with write methods and Fake
- T003 — Pike13 write-back stub

**Group 2** (depends on T001; T002 and T006 can run in parallel, T005 needs T002):
- T002 — Write-enable flag and domain guard (depends on T001)
- T006 — Admin role assignment (depends on T001)

**Group 3** (T004 and T005 depend on T002; T004 also needs T003):
- T004 — WorkspaceProvisioningService (depends on T001, T002, T003)
- T005 — CohortService.createWithOU (depends on T001, T002)

**Group 4** (depends on T004 and T006 or T005 and T006):
- T007 — ProvisioningRequestService.approve wired (depends on T004)
- T008 — Admin provisioning-requests page (depends on T006, T007) — waits for T007
- T009 — Admin cohort management page (depends on T005, T006)

**Group 5** (all prior tickets done):
- T010 — Cross-cutting integration tests
