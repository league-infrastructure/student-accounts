---
id: "014-005"
title: "Dashboard — widget cleanup"
status: todo
group: 3
depends_on: []
---

# Ticket 014-005: Dashboard — Widget Cleanup

## Acceptance Criteria

- [ ] UserCountsWidget is positioned as the first widget
- [ ] CohortsWidget is completely removed (import deleted, JSX removed)
- [ ] GET /api/admin/cohorts fetch is removed
- [ ] Dashboard renders without 404 or API errors
- [ ] Final widget order: UserCounts → PendingUsers → PendingRequests
- [ ] Component tests verify widget order and CohortsWidget absence
- [ ] Manual verification: Dashboard loads correctly with correct widget order

## Plan

### Approach

1. Open `client/src/pages/admin/Dashboard.tsx`
2. Remove the CohortsWidget import
3. Remove the CohortsWidget component from the JSX
4. Remove any useEffect or fetch logic that calls GET /api/admin/cohorts
5. Reorder remaining widgets so UserCountsWidget is first:
   - UserCountsWidget
   - PendingUsersWidget
   - PendingRequestsWidget
6. Verify no lingering state or effects related to CohortsWidget
7. Update component tests
8. Test manually in the browser

### Files to Modify

- `client/src/pages/admin/Dashboard.tsx`
- `tests/client/pages/admin/Dashboard.test.ts` (if needed)

### Testing

**Component Tests**:
- Verify UserCountsWidget is rendered first
- Verify CohortsWidget is not rendered
- Verify other widgets are rendered in correct order
- Verify no lingering fetch calls

**Manual**:
1. Log in as admin and navigate to Dashboard
2. Verify widgets load in correct order: UserCounts → PendingUsers → PendingRequests
3. Verify no API errors (check Network tab)
4. Verify no 404 for cohorts endpoint
5. Click each widget to verify navigation works

### Notes

- Verify no other pages or components reference Dashboard's cohorts fetch (may have duplicated logic elsewhere)
- If CohortsWidget is used elsewhere, only remove it from Dashboard; keep the component file for now (Ticket 004 doesn't touch it)
