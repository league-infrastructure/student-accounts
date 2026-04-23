---
id: 014-006
title: "SyncPanel \u2014 remove Claude section"
status: done
group: 3
depends_on: []
---

# Ticket 014-006: SyncPanel — Remove Claude Section

## Acceptance Criteria

- [ ] Anthropic/Claude card is completely removed from SyncPanel
- [ ] GET /api/admin/anthropic/probe fetch is removed
- [ ] All Claude-sync state is removed: probeResult, claudeSyncReport, claudeSyncing, etc.
- [ ] Pike13 section remains unchanged
- [ ] Google Workspace section remains unchanged
- [ ] SyncPanel renders without 404 or API errors
- [ ] Component tests verify Claude section is absent
- [ ] Manual verification: SyncPanel shows only Pike13 and Google Workspace

## Plan

### Approach

1. Open `client/src/pages/admin/SyncPanel.tsx`
2. Locate the Anthropic/Claude card (third bordered section)
3. Remove the entire card JSX block
4. Find the useEffect that calls GET /api/admin/anthropic/probe on mount; remove it
5. Remove all state variables related to Claude sync:
   - probeResult
   - claudeSyncReport
   - claudeSyncing
   - Any other Claude-related state
6. Remove any helper functions related to Claude sync
7. Verify Pike13 and Google Workspace sections remain intact
8. Update component tests
9. Test manually in the browser

### Files to Modify

- `client/src/pages/admin/SyncPanel.tsx`
- `tests/client/pages/admin/SyncPanel.test.ts` (if needed)

### Testing

**Component Tests**:
- Verify Claude card is not rendered
- Verify Pike13 section is rendered
- Verify Google Workspace section is rendered
- Verify no lingering fetch calls to /api/admin/anthropic/probe

**Manual**:
1. Log in as admin and navigate to Sync page
2. Verify page shows two sections: Pike13 and Google Workspace
3. Verify no Claude card is visible
4. Verify no API errors (check Network tab)
5. Verify no 404 for anthropic endpoint
6. Test Pike13 and Google Workspace controls still work

### Notes

- This is a removal-only ticket; no backend changes needed
- Verify no other pages or components reference SyncPanel's Claude logic
