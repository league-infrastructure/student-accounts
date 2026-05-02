---
id: '007'
title: "Groups \u2014 add search bar"
status: done
use-cases:
- SUC-007
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---

# Groups — add search bar

## Description

`Groups.tsx` already has sortable column headers (`name`, `description`,
`memberCount`, `createdAt`) but no way to filter the list. This ticket
adds a search bar that filters rows by group name or description.

## Acceptance Criteria

- [x] A search bar is present above the table.
- [x] Typing filters rows whose `name` or `description` contains the
      query string (case-insensitive, real-time).
- [x] Clearing the search bar restores all rows.
- [x] Existing sort functionality still works and applies to the filtered
      row set.
- [x] `npm run test:client` passes (update Groups.test.tsx as needed).

## Implementation Plan

### Approach

Add a `search` state string. In the existing `useMemo` that sorts groups,
first filter by:

```
g.name.toLowerCase().includes(q) ||
(g.description ?? '').toLowerCase().includes(q)
```

Add a search `<input>` in the toolbar area above the table.

### Files to Modify

- `client/src/pages/admin/Groups.tsx`
- `tests/client/Groups.test.tsx` — add assertion that a search bar is
  rendered and filters visible rows by name or description.

### Testing Plan

1. Update `Groups.test.tsx` to pass multiple groups and assert that
   searching for a name hides non-matching rows.
2. Run `npm run test:client`.

### Documentation Updates

None beyond the architecture update.
