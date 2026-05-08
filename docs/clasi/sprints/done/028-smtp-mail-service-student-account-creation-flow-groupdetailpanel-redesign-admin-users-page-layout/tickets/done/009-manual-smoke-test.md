---
id: 009
title: Manual smoke test
status: done
use-cases:
- SUC-001
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
- SUC-008
- SUC-009
depends-on:
- '003'
- '004'
- '007'
- 008
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke test

## Description

End-to-end manual verification of all four sprint 028 feature areas. All automated tests must
pass before this ticket begins. This ticket produces no code changes — it is a validation
checklist that must be completed by the team-lead or a designated tester against the running
dev environment.

## Acceptance Criteria

### SMTP test email (tickets 001-003)

- [ ] Navigate to My Account page. Confirm "Send test" button is visible next to the notification-email picker.
- [ ] Click "Send test" — confirm button is disabled briefly while in-flight.
- [ ] Confirm a green "Test email sent to \<addr\>" pill appears and disappears after ~5 s.
- [ ] Check the target inbox — confirm the test email arrived with subject "League Accounts - test email".
- [ ] Check the audit log (`/admin/logs` or the audit table) — confirm `account_test_email_sent` event is recorded with the correct `to` address.
- [ ] (Optional) Temporarily blank `SMTP_HOST` in dev `.env`, restart the server, click "Send test" — confirm a red "SMTP not configured" error pill appears.

### Student account creation flow (ticket 004)

- [ ] Set up a test student user with a notification email in the dev DB.
- [ ] Set `GOOGLE_WORKSPACE_TEMP_PASSWORD` in `.env` to a known value.
- [ ] Navigate to the group that contains the test student. Toggle `allows_league_account` to `true` for that student via the per-row checkbox.
- [ ] Confirm (via the Google Admin console or the mock log) that `users.insert` was called with `orgUnitPath: '/Students'`.
- [ ] Confirm `changePasswordAtNextLogin: true` in the Google Admin request.
- [ ] Confirm the welcome email arrived at the student's notification email inbox. Email body contains the new League email address and the temp password.
- [ ] Confirm `User.cohort_id` was not changed (check the dev DB).

### GroupDetailPanel redesign (tickets 005-007)

- [ ] Navigate to any group detail page.
- [ ] Confirm the "Delete Group" button appears on the far right of the same row as the group name.
- [ ] Confirm `PassphraseCard` is the first section below the description/member-count line.
- [ ] Confirm none of the five old bulk-action buttons (Create League, Remove League, Suspend, Grant LLM Proxy, Revoke LLM Proxy) are visible.
- [ ] Confirm there is no row-selection checkbox column in the member table.
- [ ] Confirm each permission column header (OAuth, LLM Proxy, Lg Acct) shows a tri-state toggle glyph.
- [ ] Find a column where all rows have the permission (☑): click the toggle — confirm all rows switch to false (☒ after refresh).
- [ ] Find a column where no rows have the permission (☒): click the toggle — confirm all rows switch to true (☑ after refresh).
- [ ] Confirm a brief "Updating..." indicator appeared in the column header while PATCHes were in flight.

### Admin users page layout (ticket 008)

- [ ] Navigate to `/admin/users`.
- [ ] Confirm no section-level bordered boxes or card-shadow containers are visible around content sections.
- [ ] Confirm the user-record header (name + emails) is still visually distinct from the rest.
- [ ] Confirm action buttons are right-aligned within their section rows rather than stacked below.
- [ ] Confirm role filter, feature filter, search, sortable columns, and row action menu all still work correctly.

## Implementation Plan

This ticket has no code changes. To execute:
1. Ensure all automated tests pass: `npm run test:server && npm run test:client`.
2. Start the dev server: `npm run dev`.
3. Work through each checklist item above.
4. Mark items done as you verify them.
5. Note any discrepancies as blockers — reopen the relevant ticket.
6. When all items are checked, mark this ticket done.
