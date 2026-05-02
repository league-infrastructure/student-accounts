---
id: "008"
title: "Manual smoke — stakeholder verification of all User Management panels"
status: todo
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
  - SUC-006
  - SUC-007
depends-on:
  - "001"
  - "002"
  - "003"
  - "004"
  - "005"
  - "006"
  - "007"
github-issue: ""
todo: ""
completes_todo: true
---

# Manual smoke — stakeholder verification of all User Management panels

## Description

After all Group 1 tickets are done and deployed to the dev environment,
the stakeholder performs a manual walkthrough of every User Management
panel to confirm the sprint goals are met. No code changes are expected
from this ticket; its acceptance criteria serve as the sign-off checklist.

## Acceptance Criteria

**Sidebar (ticket 001):**
- [ ] User Management group shows items in order: Users, Students, Staff,
      LLM Proxy Users, Groups, Cohorts.
- [ ] Labels read exactly "Staff" and "Students" (not old names).

**Users page — /admin/users (ticket 002):**
- [ ] All users in the system are listed, not just staff.
- [ ] Search bar filters by name or email.
- [ ] Clicking column headers sorts the list.
- [ ] Joined column is visible and sortable.
- [ ] Make-admin / remove-admin action available on staff/admin rows.

**Students page — /users/students (ticket 003):**
- [ ] Search bar filters by name or email.
- [ ] All column headers sort the list.

**Staff page — /staff/directory (ticket 004):**
- [ ] Joined column is visible.
- [ ] All column headers sort the list.
- [ ] Existing search bar and filters still work.

**LLM Proxy Users page — /users/llm-proxy (ticket 005):**
- [ ] Search bar filters by name or email.
- [ ] All column headers sort the list.

**Cohorts page — /cohorts (ticket 006):**
- [ ] Search bar filters by cohort name.
- [ ] Existing sort still works.

**Groups page — /groups (ticket 007):**
- [ ] Search bar filters by name or description.
- [ ] Existing sort still works.

## Testing Plan

This ticket is stakeholder-executed manual testing. No automated tests
are written or modified.

The developer verifies that `npm run test:client` passes before handing
off to the stakeholder.

## Documentation Updates

None.
