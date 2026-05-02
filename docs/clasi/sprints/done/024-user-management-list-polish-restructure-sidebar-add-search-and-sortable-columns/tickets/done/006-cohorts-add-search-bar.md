---
id: '006'
title: "Cohorts \u2014 add search bar"
status: done
use-cases:
- SUC-006
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---

# Cohorts — add search bar

## Description

`Cohorts.tsx` already has sortable column headers (`name`,
`google_ou_path`, `createdAt`) but no way to filter the list. As the
number of cohorts grows, locating a specific cohort by scrolling becomes
impractical. This ticket adds a search bar that filters rows by cohort
name.

## Acceptance Criteria

- [x] A search bar is present above the table.
- [x] Typing in the search bar filters rows to those whose `name`
      contains the query string (case-insensitive, real-time).
- [x] Clearing the search bar restores all rows.
- [x] Existing sort functionality (clicking column headers) still works
      and applies to the filtered row set.
- [x] `npm run test:client` passes (update Cohorts.test.tsx as needed).

## Implementation Plan

### Approach

Add a `search` state string. In the existing `useMemo` that sorts
cohorts, first filter by `c.name.toLowerCase().includes(q)` before
sorting. Add a search `<input>` in the toolbar area above the table.

### Files to Modify

- `client/src/pages/admin/Cohorts.tsx`
- `tests/client/Cohorts.test.tsx` — add assertion that a search bar is
  rendered and that it filters the visible rows.

### Testing Plan

1. Update `Cohorts.test.tsx` to pass multiple cohorts in the mock and
   assert that searching for one name hides the others.
2. Run `npm run test:client`.

### Documentation Updates

None beyond the architecture update.
