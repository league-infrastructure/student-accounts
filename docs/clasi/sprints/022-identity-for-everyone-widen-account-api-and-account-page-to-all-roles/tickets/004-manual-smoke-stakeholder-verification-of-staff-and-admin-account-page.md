---
id: "004"
title: "Manual smoke — stakeholder verification of staff and admin Account page"
status: todo
use-cases:
  - SUC-022-001
  - SUC-022-002
  - SUC-022-003
  - SUC-022-004
depends-on:
  - "001"
  - "002"
  - "003"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke — stakeholder verification of staff and admin Account page

## Description

Stakeholder verifies that the Account page works correctly for staff and admin
roles, and that the student experience is unchanged. This ticket is a
checklist for the manual smoke pass; it blocks sprint close.

## Acceptance Criteria

### Staff user — Account page

- [ ] Sign in as a staff user. Navigate to `/account`.
- [ ] Page renders without error. "My Account" heading is visible.
- [ ] ProfileSection displays the staff user's display name and email.
- [ ] Name is editable (click to edit, blur to save, PATCH /api/account/profile
      fires correctly).
- [ ] LoginsSection shows the staff user's linked logins.
- [ ] "Add Google" button is visible (if Google is configured in dev env).
- [ ] "Add GitHub" button is visible (if GitHub is configured in dev env).
- [ ] "Add Pike 13" button is always visible.
- [ ] WorkspaceSection is NOT visible (staff user has no workspace
      ExternalAccount and no League-format email in dev).
- [ ] HelpSection is visible at the bottom.

### Admin user — Account page

- [ ] Sign in as an admin user. Navigate to `/account`.
- [ ] Page renders without error. "My Account" heading is visible.
- [ ] ProfileSection, LoginsSection, and all three Add buttons render.
- [ ] WorkspaceSection is NOT visible (same reason as staff).
- [ ] HelpSection is visible at the bottom.

### Student user — regression

- [ ] Sign in as a student user. Navigate to `/account`.
- [ ] Page renders identically to pre-sprint-022 behavior:
  - ProfileSection and LoginsSection are visible.
  - WorkspaceSection is visible if the student has a workspace account.
  - WorkspaceSection is hidden if the student has no workspace account and
    no League-format email.
  - UsernamePasswordSection is visible if the student has credentials.

### Console / network

- [ ] No 403 errors appear in the browser console for any role.
- [ ] No React hook-order warnings in the browser console.
- [ ] `GET /api/account` returns 200 in the Network tab for staff and admin.

## Implementation Plan

This ticket has no code changes. The stakeholder runs the app locally or
against the dev deployment and checks each item in the acceptance criteria
list.

The programmer should ensure the dev environment is running before marking
this ticket ready for stakeholder review:

```bash
npm run dev
```

Staff and admin test accounts should be available via the existing admin
panel at `/admin/users`. If no staff account exists, create one by updating
an existing user's role via the admin UI.
