---
id: 014-004
title: "AppLayout \u2014 navigation reordering"
status: done
group: 2
depends_on: []
---

# Ticket 014-004: AppLayout — Navigation Reordering

## Acceptance Criteria

- [ ] ADMIN_WORKFLOW_NAV reordered: Dashboard → Users → Groups → Cohorts → Sync → Provisioning Requests
- [ ] "Account" link removed from admin navigation
- [ ] "Merge Queue" link removed from admin navigation
- [ ] All navigation items are clickable and route to correct pages
- [ ] Component tests verify nav structure
- [ ] Manual verification: Admin console shows correct nav order, no Account or Merge Queue links

## Plan

### Approach

1. Open `client/src/components/AppLayout.tsx`
2. Find the `ADMIN_WORKFLOW_NAV` constant or array
3. Reorder nav items in this sequence:
   - Dashboard (/)
   - Users (/users)
   - Groups (/groups)
   - Cohorts (/cohorts)
   - Sync (/sync)
   - Provisioning Requests (/requests)
4. Remove the "Account" navigation item
5. Remove the "Merge Queue" navigation item
6. Verify no other components reference these removed nav items
7. Update component tests if needed
8. Test manually in the browser

### Files to Modify

- `client/src/components/AppLayout.tsx`
- `tests/client/components/AppLayout.test.ts` (if needed)

### Testing

**Component Tests**:
- Verify nav items are in correct order
- Verify "Account" link is not rendered
- Verify "Merge Queue" link is not rendered
- Verify all remaining nav items are present

**Manual**:
1. Log in as admin
2. Verify navigation shows correct order
3. Click each nav item; verify routing works
4. Verify no broken links or 404s
5. Verify responsive layout (mobile menu if applicable)

### Notes

- This is a pure UI change; no backend changes needed
- Verify that users still access their Account page via the user-area dropdown at the bottom-right
