---
id: "008"
title: "Admin SyncPanel UI page"
status: todo
use-cases: [UC-004, SUC-001, SUC-002, SUC-003, SUC-004]
depends-on: ["007"]
github-issue: ""
todo: ""
---

# Admin SyncPanel UI page

## Description

Create the `SyncPanel` admin React page that gives the administrator a single
place to trigger all sync operations. The page has five action buttons (one per
sync endpoint), shows a spinner during each async POST, and displays the result
counts and any flagged-for-review accounts after each sync completes.

Wire the page into `App.tsx` at `/admin/sync` and add a "Sync" entry to the
`ADMIN_NAV` array in `AppLayout.tsx`.

## Acceptance Criteria

- [ ] `client/src/pages/admin/SyncPanel.tsx` exists.
- [ ] Five action buttons, each disabled while any sync is in-flight:
  - "Sync Pike13 People" → POST `/admin/sync/pike13`
  - "Sync Cohorts" → POST `/admin/sync/workspace/cohorts`
  - "Sync Staff" → POST `/admin/sync/workspace/staff`
  - "Sync Students" → POST `/admin/sync/workspace/students`
  - "Sync All Workspace" → POST `/admin/sync/workspace/all`
- [ ] Spinner / loading indicator shown while the POST is in flight.
- [ ] On success: result panel displays counts (created / updated / unchanged /
  flagged where applicable) per operation.
- [ ] On success with flagged accounts: flagged list rendered showing email and
  reason for each flagged ExternalAccount.
- [ ] On HTTP error: error message displayed; no crash.
- [ ] `/admin/sync` route added to `client/src/App.tsx` pointing to `SyncPanel`.
- [ ] `ADMIN_NAV` in `client/src/components/AppLayout.tsx` includes
  `{ label: 'Sync', path: '/admin/sync' }`.
- [ ] Component renders without errors when result state is empty (initial state).

## Implementation Plan

### Approach

1. Create `SyncPanel.tsx` with React state for: loading flag, last result,
   last error.
2. Each button handler makes a `fetch` POST to its endpoint (using the same
   pattern as other admin pages — check `ProvisioningRequests.tsx` or
   `Cohorts.tsx` for conventions).
3. After success, set result state from the response JSON; render count badges.
4. For the flagged list (students sync), map `flaggedAccounts` to a table.
5. Add route to `App.tsx`.
6. Add nav entry to `AppLayout.tsx`.
7. Write component tests.

### Files to Create

- `client/src/pages/admin/SyncPanel.tsx`
- `tests/client/pages/admin/SyncPanel.test.tsx`

### Files to Modify

- `client/src/App.tsx` — add `/admin/sync` route
- `client/src/components/AppLayout.tsx` — add Sync to ADMIN_NAV

### Testing Plan

- Component tests using React Testing Library:
  - Renders correctly in initial state (no results, no error).
  - Shows loading state when button clicked (mock fetch pending).
  - Shows count results after successful response.
  - Shows flagged accounts list when response includes them.
  - Shows error message on HTTP 500 response.
- No E2E test for this sprint (manual verification sufficient given stable
  backend).

### Documentation Updates

- None. Architecture update documents the page and its nav registration.
