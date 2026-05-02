---
id: '005'
title: "LlmProxyUsersPanel \u2014 add search bar and sortable column headers"
status: done
use-cases:
- SUC-005
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---

# LlmProxyUsersPanel — add search bar and sortable column headers

## Description

`LlmProxyUsersPanel.tsx` currently renders the rows in whatever order
the `/api/admin/users/with-llm-proxy` endpoint returns them, with no
ability to search or sort. The stakeholder requires a search bar and
sortable column headers on all list panels.

The panel has columns: Name, Email, Cohort, Usage, Expires.

Existing behaviour preserved: checkbox selection, bulk-revoke action.

## Acceptance Criteria

- [x] A search bar is present above the table.
- [x] Typing in the search bar filters rows by display name or email
      (case-insensitive, real-time).
- [x] Column headers Name, Email, Cohort, Usage, Expires are all
      clickable and sort the visible rows.
- [x] Clicking the same header twice toggles between ascending and
      descending.
- [x] Checkbox selection and bulk-revoke action continue to operate on
      the filtered+sorted row set.
- [x] `npm run test:client` passes.

## Implementation Plan

### Approach

Add `search`, `sortCol`, `sortDir` state. Add `applySearch` (filter by
`displayName` or `email`) and `sortRows` (sort by the active column)
functions. Wire a search `<input>` into the toolbar row. Replace the
static `<th>` elements with clickable sortable headers.

Sort helpers for each column:
- Name: `(r.displayName ?? r.email).localeCompare(...)`
- Email: `r.email.localeCompare(...)`
- Cohort: `(r.cohort?.name ?? '').localeCompare(...)`
- Usage: `r.tokensUsed - other.tokensUsed` (numeric)
- Expires: `new Date(r.expiresAt).getTime() - ...` (numeric)

### Files to Modify

- `client/src/pages/admin/LlmProxyUsersPanel.tsx`
- `tests/client/` — add or update a test for LlmProxyUsersPanel covering
  search and sort.

### Testing Plan

1. Check if an `LlmProxyUsersPanel.test.tsx` already exists; create if not.
2. Mock `/api/admin/users/with-llm-proxy` with a fixed set of rows.
3. Assert search filtering and sort toggling.
4. Run `npm run test:client`.

### Documentation Updates

None beyond the architecture update.
