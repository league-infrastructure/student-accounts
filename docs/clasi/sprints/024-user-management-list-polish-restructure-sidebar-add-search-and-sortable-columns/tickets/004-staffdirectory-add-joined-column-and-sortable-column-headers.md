---
id: "004"
title: "StaffDirectory — add Joined column and sortable column headers"
status: todo
use-cases:
  - SUC-004
depends-on: []
github-issue: ""
todo: ""
completes_todo: true
---

# StaffDirectory — add Joined column and sortable column headers

## Description

`StaffDirectory.tsx` already has a search bar, cohort filter, and
account-type filter. What it lacks is:

1. A "Joined" column showing each student's account creation date.
2. Sortable column headers on Name, Email, Cohort, Accounts, and Joined.

The page fetches from `GET /api/staff/directory`. Before adding the
column, verify that the endpoint returns a `createdAt` field in each
row. The `DirectoryStudent` TypeScript interface in the file currently
does not list `createdAt` — the interface must be extended if the field
is present in the response.

Existing behaviour preserved: search bar, cohort filter, account-type
filter, click-to-expand inline student detail panel.

## Acceptance Criteria

- [ ] Verify that `GET /api/staff/directory` returns `createdAt` on each
      row; if not, this ticket is blocked (note it and escalate).
- [ ] `DirectoryStudent` TypeScript interface includes `createdAt: string`.
- [ ] A "Joined" column is present in the table showing the formatted date.
- [ ] Column headers Name, Email, Cohort, Accounts, Joined are sortable.
- [ ] Clicking the same header twice toggles between ascending and
      descending.
- [ ] Existing search bar, cohort filter, and account-type filter still
      work and interact correctly with sort (sort applies to the filtered
      set).
- [ ] The click-to-expand inline detail panel is not broken.
- [ ] `npm run test:client` passes (update StaffDirectory.test.tsx as
      needed).

## Implementation Plan

### Approach

1. Inspect the `/api/staff/directory` route handler to confirm `createdAt`
   is included. If missing, add it to the query/serialization — this is
   a small backend change within this ticket's scope.
2. Extend `DirectoryStudent` to include `createdAt: string`.
3. Add `sortCol` / `sortDir` state to the component (initial: `name` asc
   or no sort — choose a sensible default).
4. Add a `sortStudents` helper that sorts the filtered list.
5. Replace the static array-mapped `<th>` elements with clickable
   `SortableTh` components (pattern from AdminUsersPanel).
6. Add a new `<td>` for Joined, rendering
   `new Date(student.createdAt).toLocaleDateString()`.

### Files to Modify / Create

- `client/src/pages/staff/StaffDirectory.tsx` — extend interface, add
  sort state, replace th elements, add Joined td.
- `server/src/routes/` — inspect and possibly patch the staff directory
  route to include `createdAt` in the response if absent.
- `tests/client/StaffDirectory.test.tsx` — update to assert Joined column
  visible and sortable headers exist.

### Testing Plan

1. Update `StaffDirectory.test.tsx`:
   - Assert a "Joined" column header is rendered.
   - Assert clicking a column header changes sort state (or re-renders
     rows in a different order if the test fixture has varied dates).
2. Run `npm run test:client`.

### Documentation Updates

None beyond the architecture update.
