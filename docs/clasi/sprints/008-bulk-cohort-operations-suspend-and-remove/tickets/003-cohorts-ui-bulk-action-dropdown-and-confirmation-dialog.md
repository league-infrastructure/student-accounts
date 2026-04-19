---
id: "003"
title: "Cohorts UI — bulk action dropdown and confirmation dialog"
status: todo
use-cases: [SUC-008-001, SUC-008-002, SUC-008-003, SUC-008-005, SUC-008-006]
depends-on: ["002"]
---

# Cohorts UI — bulk action dropdown and confirmation dialog

## Description

Extend `client/src/pages/admin/Cohorts.tsx` to add a "Bulk Actions" control
to each cohort row. Selecting an action opens a confirmation dialog that:
(1) fetches the affected count via the preview endpoint, (2) displays an
appropriate message for suspend vs. remove, (3) executes the operation on
confirm, and (4) shows a result panel with per-user failure details.

## Acceptance Criteria

- [ ] Each cohort row has a `<select>` (or equivalent) with four options:
      "Suspend Workspace", "Suspend Claude", "Remove Workspace", "Remove Claude".
- [ ] Selecting an option and triggering the action opens a `BulkActionDialog`
      modal for the selected cohort and action.
- [ ] The dialog fetches `GET /api/admin/cohorts/:id/bulk-preview` and displays
      the affected count in the message ("Suspend 12 Workspace accounts for
      [Cohort Name]?").
- [ ] Suspend dialog message notes the action can be reversed by re-provisioning.
- [ ] Remove dialog includes an irreversibility warning ("Workspace accounts will
      be deleted after 3 days. This action cannot be undone.").
- [ ] The Confirm button is disabled while the preview fetch is in-flight.
- [ ] On Confirm, the appropriate `POST /api/admin/cohorts/:id/bulk-suspend` or
      `bulk-remove` is called. A spinner is shown; the Confirm button is disabled.
- [ ] On completion (200 or 207), the dialog transitions to a result panel showing:
      - Number of succeeded accounts.
      - For each failed account: user name and error message.
- [ ] A "Done" / "Close" button dismisses the dialog and invalidates the cohorts
      query so the list refreshes.
- [ ] On full failure (500), an error message is shown in the dialog.
- [ ] The existing cohort list and create-cohort form remain unchanged.
- [ ] Component tests cover: dialog opens with correct count, suspend message
      shown, remove warning shown, result panel shown on success, failure list
      shown on 207.

## Implementation Plan

### Approach

Add a `BulkActionDialog` component inline in `Cohorts.tsx` or as a sibling
file `BulkActionDialog.tsx` in the same directory (either is acceptable).
Use React Query's `useQuery` for the preview fetch (triggered when dialog
opens) and `useMutation` for the execute calls — consistent with the
existing Cohorts.tsx patterns.

State needed in the parent Cohorts component:
```typescript
const [bulkAction, setBulkAction] = useState<{
  cohortId: number;
  cohortName: string;
  accountType: 'workspace' | 'claude';
  operation: 'suspend' | 'remove';
} | null>(null);
```

`bulkAction === null` means dialog is closed.

### Files to modify

- `client/src/pages/admin/Cohorts.tsx` — add bulk action state, row controls,
  and `BulkActionDialog` component (inline or imported).

### Files to create (optional)

- `client/src/pages/admin/BulkActionDialog.tsx` — if the dialog grows large
  enough to warrant its own file; otherwise keep inline.
- `tests/client/BulkActionDialog.test.tsx` — Vitest + React Testing Library.

### Key UI states

1. **Idle** — selector shows "Bulk Actions" placeholder; no dialog.
2. **Dialog open, fetching preview** — spinner in dialog; Confirm disabled.
3. **Dialog open, preview loaded** — count shown; Confirm enabled.
4. **Dialog open, executing** — spinner; Confirm disabled; Cancel disabled.
5. **Result panel** — succeeded count + failure list + "Done" button.
6. **Error state** — error message + "Close" button.

### Confirmation message templates

Suspend: "Suspend [N] [Workspace / Claude] accounts for cohort [Name]? Active
accounts will be suspended. This can be reversed by re-provisioning individual
accounts."

Remove: "Remove [N] [Workspace / Claude] accounts for cohort [Name]? Workspace
accounts will be suspended immediately and permanently deleted after 3 days.
Claude seats are released immediately. This action cannot be undone."

### Testing plan

Use Vitest + React Testing Library with `msw` (or fetch mocks) to stub the API.

Key test cases:
- Opening the dialog fires the preview request and shows the count
- Suspend dialog does not show the irreversibility warning
- Remove dialog shows the irreversibility warning
- Clicking Confirm fires the correct mutation endpoint
- Result panel shows succeeded count after 200 response
- Failure list appears after 207 response
- Error message shown on 500 response

### Documentation updates

None. Admin-only UI.

