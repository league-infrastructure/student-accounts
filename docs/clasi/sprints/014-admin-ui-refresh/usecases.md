---
status: active
---

# Sprint 014: Use Cases — Admin UI Refresh

## UC-1: Admin Navigates Cleaned-Up Navigation

**Actor**: Admin

**Main Flow**:
1. Admin logs in and views the admin console
2. Navigation shows: Dashboard → Users → Groups → Cohorts → Sync → Provisioning Requests
3. Navigation does not show Account or Merge Queue links
4. Admin clicks each nav item and lands correctly

**Acceptance Criteria**:
- [ ] Nav order is exactly as specified
- [ ] Account link removed
- [ ] Merge Queue link removed
- [ ] All nav items are clickable and route correctly

**Tickets**: 004

---

## UC-2: Admin Views Dashboard with Clean Widgets

**Actor**: Admin

**Main Flow**:
1. Admin navigates to Dashboard
2. UserCountsWidget displays at the top
3. PendingUsersWidget and PendingRequestsWidget follow below
4. CohortsWidget is completely absent
5. No 404 errors in console or network tab

**Acceptance Criteria**:
- [ ] UserCountsWidget is first
- [ ] CohortsWidget import removed
- [ ] CohortsWidget API fetch removed
- [ ] All remaining widgets load without errors

**Tickets**: 005

---

## UC-3: Admin Views Cohort Student Counts

**Actor**: Admin

**Main Flow**:
1. Admin navigates to Cohorts page
2. Cohorts list shows a Students column with member counts
3. Numbers match actual group member counts
4. Clicking a cohort shows correct members

**Acceptance Criteria**:
- [ ] Students column displays in cohorts table
- [ ] Counts are accurate
- [ ] Backend returns _count.users in cohorts endpoint
- [ ] Frontend parses and displays member count

**Tickets**: 001, 009

---

## UC-4: Admin Selects and Targets Group Members for Bulk Actions

**Actor**: Admin

**Main Flow**:
1. Admin opens Groups detail view
2. Admin sees "select all" checkbox in table header (unchecked, or indeterminate if partial)
3. Admin sees checkboxes in each row
4. Admin clicks individual rows; checkbox fills; button counts update
5. Admin clicks "select all" header checkbox; all rows check; counts update to reflect all members
6. Admin clicks a button; only selected members are affected

**Alternative**: No selection
1. Admin clicks a button without selecting rows
2. All members in the group are affected
3. Button labels show counts for all members

**Acceptance Criteria**:
- [ ] Select-all checkbox controls all row checkboxes
- [ ] Indeterminate state when partial rows selected
- [ ] Button counts match selectedIds.size when selected, or all members when empty
- [ ] Bulk actions pass userIds only when selection is non-empty

**Tickets**: 002, 003, 007, 008

---

## UC-5: Admin Edits Group Name Inline

**Actor**: Admin

**Main Flow**:
1. Admin views group detail panel
2. Admin sees group name as `<h2>` text
3. Admin clicks the name; it becomes an `<input>` field
4. Admin types new name
5. Admin presses Enter or clicks away (blur)
6. PATCH /api/admin/groups/:id sent; input becomes `<h2>` again
7. Admin can press Escape to cancel without saving

**Acceptance Criteria**:
- [ ] Group name is clickable
- [ ] Click converts to `<input>`
- [ ] Enter or blur saves
- [ ] Escape cancels
- [ ] Edit button row removed (no separate Edit/Save/Cancel buttons)

**Tickets**: 007

---

## UC-6: Admin Views and Manages LLM Proxy Access

**Actor**: Admin

**Main Flow**:
1. Admin opens Groups detail view
2. Admin sees LLM Proxy column in member table
3. Each member shows a StatusPill: "Active", "Pending", or "None"
4. Admin selects members without active proxy
5. Admin clicks "Grant LLM Proxy (N)" button
6. Members receive proxy tokens
7. LLM Proxy column updates to show "Active" for those members
8. Admin selects members with active proxy
9. Admin clicks "Revoke LLM Proxy (N)" button (only visible if ≥1 has proxy)
10. Members' proxy tokens revoked; column updates

**Acceptance Criteria**:
- [ ] LLM Proxy column visible in member table
- [ ] StatusPill shows correct status for each member
- [ ] "Grant LLM Proxy" button shows count of members without active proxy
- [ ] "Revoke LLM Proxy" button only visible if ≥1 member has active proxy
- [ ] Buttons pass correct userIds or no userIds based on selection

**Tickets**: 002, 008

---

## UC-7: Admin Syncs External Sources Without Claude

**Actor**: Admin

**Main Flow**:
1. Admin navigates to Sync page
2. Admin sees Pike13 sync section with controls
3. Admin sees Google Workspace section with controls
4. Admin does NOT see Anthropic/Claude card
5. No "Claude sync" buttons or related UI elements

**Acceptance Criteria**:
- [ ] Anthropic card completely removed
- [ ] Claude sync state and effects removed
- [ ] Pike13 section intact
- [ ] Google Workspace section intact

**Tickets**: 006

---

## UC-8: Admin Removes a Member from a Group

**Actor**: Admin

**Main Flow**:
1. Admin opens Groups detail view
2. Admin selects the member(s) to remove
3. Admin clicks "Remove League (N)" button
4. Optional: confirmation dialog appears
5. Members are removed from the group
6. Member list updates; counts decrement

**Note**: Per-row remove button is removed; this action now uses bulk selection.

**Acceptance Criteria**:
- [ ] Per-row remove button absent
- [ ] "Remove League" bulk button present and counts correctly
- [ ] Bulk remove action respects selection (only removes selected members)
- [ ] List updates after removal

**Tickets**: 008

---

## UC-9: Admin Provisions Workspaces for Group Members

**Actor**: Admin

**Main Flow**:
1. Admin opens Groups detail view
2. Admin selects members who need workspaces
3. Admin clicks "Create League (N)" button
4. Button shows only members without active/pending workspace
5. Provisioning starts for selected members
6. Members' workspace status updates

**Acceptance Criteria**:
- [ ] "Create League" button shows count of members without workspace
- [ ] Button counts update based on selection
- [ ] Bulk provision action respects userIds filter
- [ ] Members' workspace status updates after provisioning

**Tickets**: 008

---

## UC-10: Admin Suspends Members in Bulk

**Actor**: Admin

**Main Flow**:
1. Admin opens Groups detail view
2. Admin selects members to suspend
3. Admin clicks "Suspend (N)" button
4. Button shows only non-suspended members
5. Selected members are suspended
6. Member list updates to show suspension status

**Acceptance Criteria**:
- [ ] "Suspend" button shows count of non-suspended members
- [ ] Counts update based on selection
- [ ] Bulk suspend action respects userIds filter
- [ ] Member status updates after suspension

**Tickets**: 008

---

## Use Case to Ticket Mapping

| Ticket | Use Cases |
|--------|-----------|
| 001 | UC-3 |
| 002 | UC-4, UC-6 |
| 003 | UC-4, UC-8, UC-9 |
| 004 | UC-1 |
| 005 | UC-2 |
| 006 | UC-7 |
| 007 | UC-4, UC-5 |
| 008 | UC-4, UC-6, UC-8, UC-9, UC-10 |
| 009 | UC-3 |
