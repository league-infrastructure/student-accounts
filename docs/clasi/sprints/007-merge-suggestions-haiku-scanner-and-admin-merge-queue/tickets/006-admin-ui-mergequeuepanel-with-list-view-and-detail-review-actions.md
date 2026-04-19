---
id: "006"
title: "Admin UI — MergeQueuePanel with list view and detail review actions"
status: todo
use-cases: [SUC-007-002, SUC-007-003]
depends-on: ["005"]
github-issue: ""
todo: ""
---

# Admin UI — MergeQueuePanel with list view and detail review actions

## Description

Create `client/src/pages/admin/MergeQueuePanel.tsx` and wire it into the admin
app. Follow the component and styling patterns established by `SyncPanel.tsx` and
`ProvisioningRequests.tsx` for consistency.

The page has two views:

**Queue List View** (default, at `/admin/merge-queue`):
- Fetches `GET /admin/merge-queue` via React Query.
- Renders a table: User A (name + email), User B (name + email), Confidence
  (formatted as `82%`), Rationale (truncated to ~80 chars), Status badge, Review button.
- Empty state: "No pending merge suggestions."
- Shows total pending count in page header.

**Detail View** (at `/admin/merge-queue?id=NNN` or inline):
- Fetches `GET /admin/merge-queue/:id`.
- Side-by-side comparison cards: User A | User B.
  Each card: name, email, created_via, created_at, Logins list, ExternalAccounts list.
- Confidence score and full rationale displayed prominently.
- Survivor selector: radio buttons "User A is survivor" / "User B is survivor."
- Action buttons: "Approve Merge" (disabled until survivor selected), "Reject", "Defer."
- Loading spinners during async POST operations.
- Error display on API failure.
- On approve or reject: navigates back to list view.

## Acceptance Criteria

- [ ] `MergeQueuePanel.tsx` exists at `client/src/pages/admin/MergeQueuePanel.tsx`.
- [ ] Route `/admin/merge-queue` renders the panel.
- [ ] List view renders table with all required columns.
- [ ] List view shows empty state message when queue is empty.
- [ ] "Review" button navigates to detail view for that suggestion.
- [ ] Detail view shows side-by-side User comparison with Logins and ExternalAccounts.
- [ ] "Approve Merge" button is disabled until a survivor is selected.
- [ ] Approve calls `POST /admin/merge-queue/:id/approve` with `{ survivorId }`.
- [ ] Reject calls `POST /admin/merge-queue/:id/reject`.
- [ ] Defer calls `POST /admin/merge-queue/:id/defer`.
- [ ] On approve / reject: UI navigates back to the queue list.
- [ ] API error response is displayed to the user.
- [ ] `ADMIN_NAV` in `AppLayout.tsx` includes "Merge Queue" linking to `/admin/merge-queue`.
- [ ] `App.tsx` includes route `/admin/merge-queue` → `MergeQueuePanel`.

## Implementation Plan

### Approach

1. Create `client/src/pages/admin/MergeQueuePanel.tsx`.
2. Use `useQuery` (React Query) for `GET /admin/merge-queue` in list view.
3. Use `useQuery` for `GET /admin/merge-queue/:id` in detail view.
4. Use `useMutation` for each action POST.
5. Use React state for detail-view toggle and survivor selection.
6. Wire into `client/src/App.tsx` admin routes.
7. Add nav entry to `client/src/components/AppLayout.tsx` `ADMIN_NAV` array.

### Files to Create/Modify

- `client/src/pages/admin/MergeQueuePanel.tsx` — new
- `client/src/App.tsx` — add `/admin/merge-queue` route
- `client/src/components/AppLayout.tsx` — add Merge Queue to `ADMIN_NAV`

### Testing Plan

- React Testing Library tests in `tests/client/`:
  - Renders "No pending merge suggestions" when API returns empty array.
  - Renders a row per suggestion.
  - "Approve Merge" button is disabled until survivor radio selected.
  - Clicking "Approve Merge" with survivor selected calls the approve mutation.
- Run `npm run test:client` to verify no regressions.

### Documentation Updates

None required.
