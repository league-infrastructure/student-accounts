---
id: '005'
title: "Claude Team Integration \u2014 Seat Provisioning and Individual Lifecycle"
status: done
branch: sprint/005-claude-team-integration-seat-provisioning-and-individual-lifecycle
use-cases:
- UC-006
- UC-008
- UC-009
- UC-015
- UC-016
- UC-017
---

# Sprint 005: Claude Team Integration — Seat Provisioning and Individual Lifecycle

## Goal

Complete the individual provisioning and lifecycle surface: Claude Team seat
provisioning, admin-managed login operations, and individual suspend/remove
for both Workspace and Claude accounts. After this sprint administrators can
fully manage a single student's accounts.

## Use Cases Delivered

- **UC-006** — Admin provisions Claude Team seat: invite via League Workspace
  address only; blocked until active Workspace account exists.
- **UC-008** — Admin adds Login on user's behalf (Google or GitHub).
- **UC-009** — Admin removes Login on user's behalf (blocked if last Login).
- **UC-015** — Individual suspend of an External Account (Workspace or Claude).
- **UC-016** — Individual remove of an External Account: Workspace follows
  suspend-then-schedule-delete-in-3-days; Claude seat is released immediately.
- **UC-017** — Deprovision student leaving school: composite of UC-015/016
  applied per account type; Pike13 and GitHub left untouched.

## Scope

- Claude Team admin API client module: invite/add seat, suspend seat, remove
  seat, list seats.
- "Provision Claude Team Seat" button on admin user detail: pre-condition
  check (active Workspace account required).
- "Suspend" and "Remove" action buttons on each External Account in admin
  user detail view, with confirmation dialogs.
- 3-day deletion scheduler for Workspace accounts (suspend now, delete later).
- Admin login management on user detail: Add Login (triggers OAuth), Remove
  Login (with last-Login guard).
- Provisioning request approval flow: admin can approve a pending
  ProvisioningRequest and execute the corresponding provisioning action.
- Audit events for all actions in scope.
- Pike13 write-back call site for GitHub Login add (stub until Sprint 006).

## Dependencies

- Sprint 001 (data model, audit service).
- Sprint 002 (auth).
- Sprint 003 (ProvisioningRequest records to approve).
- Sprint 004 (Workspace accounts must exist before Claude seats; cohort
  management and admin user detail view scaffolding).

## Non-Goals

- No bulk cohort operations (Sprint 008).
- Pike13 write-back for GitHub Login: call site is here, implementation is
  Sprint 006.
- No merge queue (Sprint 007).

## Rationale

Claude Team provisioning is gated on Workspace (hard requirement per the
spec). Landing it in Sprint 005 after Workspace (Sprint 004) respects that
dependency. The individual suspend/remove and admin login management are
grouped here because they all appear on the same admin user detail view and
share the ExternalAccount lifecycle state machine — splitting them would
leave the detail view half-functional.

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Schema migration: add scheduled_delete_at to ExternalAccount | — | 1 |
| 002 | ClaudeTeamAdminClient and FakeClaudeTeamAdminClient | — | 1 |
| 003 | Extend Pike13WritebackStub with githubHandle call site | — | 1 |
| 004 | ClaudeProvisioningService | 001, 002 | 2 |
| 005 | ExternalAccountLifecycleService (suspend and remove) | 001, 002 | 2 |
| 006 | WorkspaceDeleteJob — scheduled hard-delete of Workspace accounts | 001, 002 | 2 |
| 007 | Wire ProvisioningRequestService.approve for Claude requests | 004 | 3 |
| 008 | Admin API routes — external account lifecycle and Claude provisioning | 004, 005 | 3 |
| 009 | Admin API route — deprovision student (composite remove) | 005 | 3 |
| 010 | Admin API routes — add and remove Login on user's behalf | 003 | 3 |
| 011 | Admin user detail UI — Claude provisioning, lifecycle actions, login management | 007, 008, 009, 010 | 4 |

**Execution Groups:**
- Group 1 (parallel): T001, T002, T003 — foundation with no inter-dependencies.
- Group 2 (parallel, after Group 1): T004, T005, T006 — services built on the new client and schema.
- Group 3 (parallel, after Group 2): T007, T008, T009, T010 — routes and wiring.
- Group 4 (after Group 3): T011 — UI that consumes all API routes.
