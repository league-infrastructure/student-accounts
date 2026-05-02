---
id: "006"
title: "Manual smoke — stakeholder verification"
status: todo
use-cases:
  - SUC-023-001
  - SUC-023-002
  - SUC-023-003
  - SUC-023-004
  - SUC-023-005
  - SUC-023-006
depends-on:
  - "023-003"
  - "023-004"
  - "023-005"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke — stakeholder verification

## Description

This is the final acceptance gate for sprint 023. All automated tests pass
before this ticket is started. The stakeholder runs the following manual flows
in the browser against the dev server to confirm the policy changes feel correct
and the UI is clear and friendly.

This ticket is not assigned to the programmer agent. The team-lead flags this
ticket for the stakeholder after tickets 003, 004, and 005 are done.

## Acceptance Criteria

- [ ] **Student scope restriction (browser)**: Log in as a student. Navigate to `/oauth-clients`. Verify that only the `profile` scope checkbox appears in the create form. Attempt to create a client with `profile` only — confirm success and secret modal.
- [ ] **Student cap (browser)**: With the student now having one client, reload the page. Verify the create button is absent and a cap explanation message is displayed.
- [ ] **Student cap API bypass**: Using `curl` or a REST client, POST to `/api/oauth-clients` with a student session cookie and `allowed_scopes: ["users:read"]`. Confirm 403 response.
- [ ] **Staff unrestricted**: Log in as a staff user. Navigate to `/oauth-clients`. Verify both scope checkboxes appear. Create a client with `users:read` — confirm 201 and secret modal.
- [ ] **Admin shared pool**: Log in as Admin A. Create an OAuth client. Log in as Admin B. Navigate to `/oauth-clients` — confirm Admin A's client is visible. Rotate Admin A's client secret from Admin B's session — confirm success.
- [ ] **Compat redirect removed (server)**: `curl -v http://localhost:3000/api/admin/oauth-clients` (with a valid session or auth header) returns 404, not a 308 redirect.
- [ ] **Compat redirect removed (client)**: Navigate to `http://localhost:5173/admin/oauth-clients` in the browser — confirm the NotFound page renders (no redirect to `/oauth-clients`).

## Implementation Plan

This ticket has no code changes. The stakeholder executes the checklist above
using the dev server (`npm run dev`).

### Verification Setup

1. Ensure `npm run dev` is running with the latest code from the sprint branch.
2. Have at least two test admin accounts available (for the shared-pool check).
3. Have a student account and a staff account available.

### Pass Condition

All checklist items above are checked. The stakeholder marks this ticket done
and the sprint can be closed.
