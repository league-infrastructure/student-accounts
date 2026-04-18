---
id: "004"
title: "Google Workspace Integration — Cohort OUs and Workspace Provisioning"
status: roadmap
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

_(To be created when this sprint enters Detail Mode.)_
