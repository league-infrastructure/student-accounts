---
id: "009"
title: "Manual smoke: end-to-end verification of group permissions and provisioning"
status: todo
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
  - SUC-006
  - SUC-007
  - SUC-008
  - SUC-009
depends-on:
  - "003"
  - "004"
  - "005"
  - "006"
  - "007"
  - "008"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke: end-to-end verification of group permissions and provisioning

## Description

Stakeholder-performed manual verification of all sprint 026 behaviors against the
running dev stack. This ticket is not automated — it is a checklist for the stakeholder
to work through after all other tickets are done and the dev server is running.

All automated tests should already pass before this ticket begins. This ticket catches
integration gaps that tests cannot (e.g., real Workspace provisioning, UI feel).

## Acceptance Criteria

### Schema and group toggles (tickets 001, 005, 007)

- [ ] Navigate to a group detail page. Three permission toggles are visible: "OAuth Client registration", "LLM Proxy access", "League Account provisioning".
- [ ] Each toggle starts in the correct state (all false for a new group).
- [ ] Toggle "OAuth Client registration" on → PATCH fires; toggle stays on after reload.
- [ ] Toggle "LLM Proxy access" on → PATCH fires; toggle stays on after reload.
- [ ] Toggle "League Account provisioning" on → loading indicator appears; toggle stays on after reload.

### OAuth client gate (ticket 003)

- [ ] Log in as a student user who is NOT in any OAuth-client group and has zero existing clients.
- [ ] Navigate to OAuth Clients page → attempt to create a client.
- [ ] Receive a 403 error identifying `allowsOauthClient` as the missing permission.
- [ ] Add the student to a group with `allowsOauthClient=true`.
- [ ] Attempt to create a client again → succeeds (201).

### OAuth client grandfather (ticket 003)

- [ ] Identify a student who already has at least one existing OAuth client but is NOT in any OAuth-client group.
- [ ] Attempt to create another client → succeeds (grandfather rule applies).

### LLM proxy grant gate (ticket 004)

- [ ] As admin, attempt to grant an LLM proxy token to a student who is NOT in any llm-proxy group.
- [ ] Receive 403 identifying `allowsLlmProxy` as missing.
- [ ] Add the student to a group with `allowsLlmProxy=true`.
- [ ] Grant the token → succeeds.
- [ ] Verify that existing active tokens for other users are not revoked when a group's `allowsLlmProxy` is toggled off.

### League account provisioning (tickets 005, 006)

- [ ] Create a group without any members. Toggle `allowsLeagueAccount` on → no provisioning triggered (no members).
- [ ] Add a student who has no Workspace account to the group → provisioning is triggered; the student's Workspace account appears in `/Students` OU.
- [ ] Toggle `allowsLeagueAccount` off for the group → the student's Workspace account is not deleted.
- [ ] Create a second group with `allowsLeagueAccount=true`. Add a student who already has a Workspace account → no duplicate provisioning.
- [ ] Toggle `allowsLeagueAccount` on for a group with 3+ members who have no Workspace accounts → all receive accounts in `/Students`.

### Workspace sync (ticket 006)

- [ ] Run workspace sync (if the Google client is configured in dev) → students upserted with `cohort_id=null`; no per-cohort OU iteration errors.

### AdminUsersPanel lozenges (ticket 008)

- [ ] Navigate to `/admin/users`.
- [ ] Feature lozenge bar shows: `Google`, `Pike 13`, `GitHub` — exactly three lozenges.
- [ ] No "LLM Proxy" lozenge present.
- [ ] No "OAuth Client" lozenge present.
- [ ] Clicking `Google` lozenge filters the user list correctly.

## Implementation Plan

This is a manual verification ticket. No code changes are required.

### Checklist instructions

Work through the acceptance criteria above sequentially. Mark each checkbox as you
complete it. If a check fails, open a bug or note the issue and determine whether it
blocks sprint close.

### Prerequisites

- All tickets 001–008 must be in `done` status.
- Dev server is running with a fresh `prisma db push`.
- At least one test student user exists in the dev database.
- Google Workspace integration may be mocked or skipped for provisioning checks if
  the Google client is not configured in the dev environment; note any items skipped.

### Documentation updates

None required.
