---
id: "006"
title: "Pike13 Sync and Write-Back"
status: roadmap
branch: sprint/006-pike13-sync-and-write-back
use-cases: [UC-004, UC-020]
---

# Sprint 006: Pike13 Sync and Write-Back

## Goal

Connect to Pike13: import person records as Users via sync, and write League
email address and GitHub username back to Pike13 custom fields so parents see
them.

## Use Cases Delivered

- **UC-004** — Pike13 sync: administrator-triggered (manual or scheduled);
  creates unmatched User records with a Pike13 ExternalAccount; runs merge
  similarity check stub for each new user; reports sync counts.
- **UC-020** — Pike13 write-back: after a GitHub Login is added to a user
  with a linked Pike13 record, write the GitHub username to the "GitHub
  Username" custom field; after a Workspace account becomes active, write the
  League email to the "League Email Address" custom field.

## Scope

- Pike13 API client module: list/search people, read person details, update
  custom fields.
- Pike13 sync action: paginate Pike13 people, match against existing Users
  by Pike13 ID or email, create new Users + ExternalAccount(type=pike13) for
  unmatched records, report created/matched/skipped/error counts.
- Merge similarity check call on each new sync-created user (stub until
  Sprint 007 — same call site from Sprint 002 is reused).
- Write-back service: fills in the stub call sites planted in Sprints 004 and
  005; called after Workspace provisioning and after GitHub Login creation.
- Pike13 custom fields must be pre-created in Pike13 before integration can
  work ("GitHub Username" and "League Email Address") — noted as a deployment
  prerequisite.
- Audit events for sync operation and each write-back.
- Error handling: write-back failure does not roll back the primary action;
  failure is logged and surfaced to the administrator.

## Dependencies

- Sprint 001 (data model, audit service).
- Sprint 002 (auth — admin must be signed in to trigger sync).
- Sprint 004 (Workspace provisioning write-back call site exists).
- Sprint 005 (GitHub Login admin add write-back call site exists).
- External: Pike13 API credentials; Pike13 custom fields pre-created.

## Non-Goals

- No Pike13 enrollment, billing, or class scheduling.
- No deprovisioning of Pike13 records (spec non-goal).
- Merge queue logic is still stubbed — Sprint 007 fills it in.

## Rationale

Pike13 sync is the primary source of duplicate users (a student signs in
with GitHub, then sync creates a second record from Pike13). Delivering
Pike13 in Sprint 006 means Sprint 007 (merge suggestions) can test with
realistic duplicate scenarios. Write-back is bundled with sync because both
touch the Pike13 API client — keeping them in the same sprint avoids a
partial client in one sprint and the rest in another.

## Tickets

_(To be created when this sprint enters Detail Mode.)_
