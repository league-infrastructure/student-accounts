---
id: "003"
title: "StudentAccountsPanel — add search bar and sortable column headers"
status: todo
use-cases:
  - SUC-003
depends-on: []
github-issue: ""
todo: ""
completes_todo: true
---

# StudentAccountsPanel — add search bar and sortable column headers

## Description

`StudentAccountsPanel.tsx` currently loads newest-first by default but
provides no way for the admin to re-sort or to search by name or email.
The stakeholder requires a search bar and sortable column headers on all
list panels.

The Joined column already exists in this panel. What is missing is:
- A search bar (`<input type="search">`) that filters the displayed rows
  by display name or email, client-side.
- Clickable column headers that sort by the clicked column; repeated
  clicks toggle direction.

The checkbox selection and bulk-suspend action are not changed.

## Acceptance Criteria

- [ ] A search bar is present above the table.
- [ ] Typing in the search bar filters rows by display name or email
      (case-insensitive, real-time).
- [ ] Column headers Name, Email, Cohort, Accounts, Joined are all
      clickable and sort the visible (already filtered) rows.
- [ ] Clicking the same header twice toggles between ascending and
      descending.
- [ ] Default sort remains newest-first (Joined descending) when no
      header has been clicked and the search bar is empty.
- [ ] Checkbox selection and bulk-suspend action continue to operate on
      the filtered+sorted row set.
- [ ] `npm run test:client` passes (update or add tests as needed).

## Implementation Plan

### Approach

Add a `search` state string and a `sortCol` / `sortDir` state pair.
Apply search filtering before sorting in the `useMemo` that currently
only filters by email domain. Replace the plain `<th>` elements with a
`SortableTh` helper (pattern copied from UsersPanel / AdminUsersPanel).

### Files to Modify

- `client/src/pages/admin/StudentAccountsPanel.tsx`
  - Add `search`, `sortCol`, `sortDir` state.
  - Add `applySearch` and `sortStudents` functions (or inline them).
  - Add search `<input>` in the toolbar row above the table.
  - Replace static `<th>` elements with clickable sortable headers.
- `tests/client/` — add or update a test for StudentAccountsPanel that
  covers search filtering and sort toggling.

### Testing Plan

1. Check if a `StudentAccountsPanel.test.tsx` already exists;
   if not, create one.
2. Mock `/api/admin/users` to return a mix of student and non-student rows.
3. Assert that the search bar filters correctly.
4. Assert that clicking a column header changes sort order.
5. Run `npm run test:client`.

### Documentation Updates

None beyond the architecture update.
