---
id: 014-008
title: "GroupDetailPanel \u2014 LLM proxy column, button redesign"
status: in-progress
group: 4
depends_on:
- 014-002
- 014-003
---

# Ticket 014-008: GroupDetailPanel — LLM Proxy Column, Button Redesign

## Acceptance Criteria

- [ ] LLM Proxy column added to member table (after Claude column)
- [ ] Each member shows a StatusPill: active, pending, or none (from Ticket 002 backend)
- [ ] Buttons use shared shadcn/ui Button component (no inline styles)
- [ ] All buttons present: Create League, Remove League, Suspend, Grant LLM Proxy, Revoke LLM Proxy
- [ ] Button counts reflect effective selection:
   - Create League: members without active/pending workspace
   - Remove League: members with active workspace
   - Suspend: non-suspended members
   - Grant LLM Proxy: members without active proxy
   - Revoke LLM Proxy: members with active proxy
- [ ] Revoke LLM Proxy button only visible if ≥1 member has active proxy
- [ ] All buttons pass userIds (from selectedIds) when selection is non-empty; omit when empty
- [ ] Per-row "Remove" button is removed
- [ ] "Invite Claude" button removed
- [ ] "Delete All" button removed
- [ ] Component tests verify button counts and visibility
- [ ] Manual verification: Buttons show correct counts, selection affects counts, actions work

## Plan

### Approach

1. Open `client/src/pages/admin/GroupDetailPanel.tsx` (continuing from Ticket 007)
2. **Add LLM Proxy column**:
   - Add new column header: "LLM Proxy"
   - For each member, render `<StatusPill status={member.llmProxyToken.status} />` (or similar)
   - Integrate with Ticket 002 response field

3. **Redesign button set**:
   - Replace old BulkButton styled buttons with `Button` component from `components/ui/button.tsx`
   - Define button metadata with variant, label, count logic, and condition to show:
     ```typescript
     const effectiveTarget = selectedIds.size > 0 ? selectedIds : new Set(members.map(m => m.id));
     
     const buttons = [
       {
         label: "Create League",
         count: members.filter(m => !m.workspace?.active && !m.workspace?.pending).length,
         variant: "default",
         onClick: () => bulk-provision
       },
       // ... more buttons
     ];
     ```
   - Compute counts dynamically based on member state and selection
   - Count logic:
     - Create League: members without active/pending workspace (check members.workspace state)
     - Remove League: members with active workspace
     - Suspend: non-suspended members (check members.suspended state)
     - Grant LLM Proxy: members without active proxy (from Ticket 002: llmProxyToken.status !== "active")
     - Revoke LLM Proxy: members with active proxy (from Ticket 002: llmProxyToken.status === "active")

4. **Visibility logic**:
   - All buttons show except Revoke LLM Proxy
   - Revoke LLM Proxy shows only if count > 0 (at least one member has active proxy)

5. **Button actions**:
   - Each button calls its corresponding bulk-action endpoint
   - Pass `userIds: [...selectedIds]` when selectedIds.size > 0
   - Omit userIds when selectedIds.size === 0 (backend acts on all members)

6. **Cleanup old code**:
   - Remove "Invite Claude" button
   - Remove "Delete All" button
   - Remove per-row "Remove" button (last column in member table)
   - Remove any BulkButton custom styling

### Files to Modify

- `client/src/pages/admin/GroupDetailPanel.tsx`
- `tests/client/pages/admin/GroupDetailPanel.test.ts` (or equivalent)

### Testing

**Unit/Component Tests**:
- Test button counts are correct for various member states
- Test Revoke LLM Proxy visibility (only when count > 0)
- Test button API calls pass userIds when selection is non-empty
- Test button API calls omit userIds when selection is empty
- Test button labels include correct count
- Test all buttons use Button component (no inline styles)

**Manual**:
1. Navigate to Groups detail
2. Select various combinations of members
3. Verify button counts update with selection:
   - No selection: counts reflect all members
   - Partial selection: counts reflect only selected members
4. Click each button; verify correct API call (check Network tab)
5. Verify Revoke LLM Proxy button appears only when at least one member has active proxy
6. Verify old buttons are gone ("Invite Claude", "Delete All", per-row Remove)
7. Verify LLM Proxy column shows correct status for each member
8. Verify all button styling is consistent (shadcn/ui Button)

### Notes

- Ticket 007 sets up selectedIds state; this ticket uses it for counts
- Ticket 002 provides llmProxyToken status in response
- Ticket 003 enables bulk-action userIds filter
- Count logic depends on member object shape; verify fields exist (workspace, suspended, llmProxyToken)
