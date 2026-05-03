---
id: '007'
title: 'Manual smoke test: stakeholder verification'
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
depends-on:
- '001'
- '002'
- '004'
- '005'
- '006'
github-issue: ''
todo: ''
completes_todo: true
---

# Manual smoke test: stakeholder verification

## Description

All automated tests for this sprint pass as part of each ticket's acceptance
criteria. This ticket is the stakeholder's manual verification pass before the
sprint is closed. No code is written here; this ticket tracks the sign-off.

## Acceptance Criteria

**Login removal confirmation (ticket 001):**
- [ ] On the Account page, clicking "Remove" next to a login provider opens the styled confirm dialog — not a browser popup.
- [ ] The dialog names the provider being removed.
- [ ] Clicking "Cancel" closes the dialog; the login remains.
- [ ] Clicking "Confirm" removes the login.

**Student with non-League email (ticket 002):**
- [ ] Navigate to /admin/users and click the "Student" lozenge.
- [ ] A user account with a non-League primary email (e.g., `eric@civicknowledge.com`) and role `student` appears in the list.

**Unified Users page — all roles (ticket 005):**
- [ ] Navigate to /admin/users with "All" selected. Admin, staff, and student users all appear.
- [ ] Cohort column is absent from the table.

**Role lozenge filtering (ticket 005):**
- [ ] Clicking "Staff" shows only staff users.
- [ ] Clicking "Admin" shows only admin users.
- [ ] Clicking "Student" shows only student users (including non-League email students).
- [ ] Clicking "All" restores the full list.

**Feature lozenge filtering (ticket 005):**
- [ ] Clicking "Google" shows only users with a Google login.
- [ ] Clicking "LLM Proxy" shows only users with an active LLM proxy token.
- [ ] Clicking both "Google" and "LLM Proxy" shows only users who have BOTH.
- [ ] Deactivating both returns the full (role-filtered) list.

**Sidebar (ticket 006):**
- [ ] The "User Management" sidebar group has exactly two children: "User Management" and "Groups".
- [ ] Navigating to /users/students, /users/llm-proxy, /staff/directory, /cohorts, /cohorts/1 returns 404 or a redirect.

**Bulk actions (ticket 005):**
- [ ] Selecting student rows and clicking "Suspend accounts" shows a confirm dialog; confirming suspends their workspace/Claude accounts.
- [ ] Selecting rows with LLM proxy active and clicking "Revoke LLM Proxy" shows a confirm dialog; confirming revokes their tokens.

**Sync investigation (ticket 004):**
- [ ] Sync page (if accessible) runs without errors. If cohort-writes were redirected to Groups, confirm a Group is created with the expected name after a sync run.

## Testing

- **Existing tests to run**: Full suite has been run per each ticket. No new automated tests in this ticket.
- **New tests to write**: None — this is a manual verification ticket.
- **Verification command**: Run the dev server (`npm run dev`) and manually exercise each checklist item above.
