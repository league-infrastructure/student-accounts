---
id: 014-007
title: "GroupDetailPanel \u2014 click-to-edit name, row selection"
status: in-progress
group: 4
depends_on:
- 014-002
---

# Ticket 014-007: GroupDetailPanel — Click-to-Edit Name, Row Selection

## Acceptance Criteria

- [ ] Group name `<h2>` is clickable; click converts to `<input>`
- [ ] Enter or blur saves the name (PATCH /api/admin/groups/:id)
- [ ] Escape cancels edit without saving
- [ ] Edit button row removed (no separate Edit/Save/Cancel buttons)
- [ ] Row selection: checkboxes visible in header and each row
- [ ] Select-all checkbox in header controls all row checkboxes
- [ ] Select-all checkbox shows indeterminate state when partial rows selected
- [ ] `selectedIds: Set<string>` state tracks selected rows
- [ ] Row selection state updates button counts (Ticket 008 integrates)
- [ ] Component tests verify click-to-edit and selection logic
- [ ] Manual verification: Name edit works, checkboxes work, counts update

## Plan

### Approach

1. Open `client/src/pages/admin/GroupDetailPanel.tsx`
2. **Click-to-edit name**:
   - Remove the Edit/Save/Cancel button row
   - Add `isEditingName` state
   - Convert `<h2>` to a clickable element; click sets isEditingName=true
   - When isEditingName=true, render `<input>` with the name value
   - On input blur or Enter key, call PATCH /api/admin/groups/:id with new name
   - On Escape, cancel without saving
   - On success, update component state and set isEditingName=false

3. **Row selection**:
   - Add `selectedIds: Set<string>` state
   - Add select-all checkbox in table header
   - Add checkbox in first column of each row
   - Implement click handlers:
     - Select-all checkbox: if not all selected, select all; if all selected, deselect all
     - Row checkbox: toggle that row's selection
     - Update indeterminate state for select-all when partial selection
   - Add helper functions to compute "effective target":
     - If selectedIds.size > 0: target = selectedIds
     - If selectedIds.size === 0: target = all members (for bulk actions)

4. **Integration with button counts** (Ticket 008 will use these):
   - Expose selectedIds or a getter function for button count logic
   - Document how button counts should use selectedIds

### Files to Modify

- `client/src/pages/admin/GroupDetailPanel.tsx`
- `tests/client/pages/admin/GroupDetailPanel.test.ts` (or equivalent)

### Testing

**Unit/Component Tests**:
- Test click name → input → save works
- Test click name → input → escape cancels
- Test Enter key saves, blur saves
- Test row checkbox toggle updates selectedIds
- Test select-all checkbox controls all rows
- Test indeterminate state for select-all

**Manual**:
1. Navigate to Groups detail
2. Click group name; verify it becomes editable
3. Type new name; press Enter or click away; verify save
4. Click group name; type new name; press Escape; verify cancel
5. Click row checkbox; verify selection updates
6. Click select-all checkbox; verify all rows select
7. Click select-all again; verify all rows deselect
8. Partially select rows; verify select-all shows indeterminate
9. Verify no edit button row exists

### Notes

- This ticket focuses on UI mechanics; Ticket 008 integrates with button logic
- Proxy status is fetched by Ticket 002, so name editing should work independently
