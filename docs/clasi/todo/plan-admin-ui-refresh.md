---
status: pending
---

# Plan: Admin UI Refresh

## Context
The admin UI needs a significant cleanup across navigation, dashboard, cohorts, groups, and sync pages. The changes reduce clutter, improve the group workflow with per-row selection, and remove features that aren't used (Claude sync, Invite Claude, Delete All).

---

## Files to Modify

### Frontend
1. `client/src/components/AppLayout.tsx`
2. `client/src/pages/admin/Dashboard.tsx`
3. `client/src/pages/admin/Cohorts.tsx`
4. `client/src/pages/admin/GroupDetailPanel.tsx`
5. `client/src/pages/admin/SyncPanel.tsx`

### Backend
6. Server cohorts route (find via `grep -r "admin/cohorts" server/src/routes` — likely `server/src/routes/admin/cohorts.ts`)
7. Server group bulk-action routes (likely `server/src/routes/admin/groups.ts`)
8. Server group members endpoint — add LLM proxy status per member

---

## Change Details

### 1. AppLayout.tsx — Nav reorder
- Remove "Account" link from admin nav (admins reach Account via user-area dropdown at bottom)
- Remove "Merge Queue" link
- New `ADMIN_WORKFLOW_NAV` order:
  1. Dashboard (`/`)
  2. Users (`/users`)
  3. Groups (`/groups`)
  4. Cohorts (`/cohorts`)
  5. Sync (`/sync`)
  6. Provisioning Requests (`/requests`) — at bottom, least-used

### 2. Dashboard.tsx — Widget cleanup
- Move `UserCountsWidget` to **first** position (currently last)
- Remove `CohortsWidget` entirely (including its import and `GET /api/admin/cohorts` fetch)
- Final order: UserCounts → PendingUsers → PendingRequests

### 3. Cohorts.tsx — Student count column
- Add a **Students** column to the cohorts table
- Backend returns `_count.users`; display as plain number
- Requires backend change (see §6)

### 4. GroupDetailPanel.tsx — Major redesign

#### Group name: click-to-edit
- Remove the separate Edit/Save/Cancel button row for group name
- The `<h2>` group name is click-to-edit: click → `<input>`, Enter or blur → PATCH saves, Escape cancels

#### Row selection
- Add a select-all checkbox in the header (indeterminate when partial)
- Add a per-row checkbox as the first cell
- Track `selectedIds: Set<string>` in state
- **Semantics:** no rows selected = all members are the effective target; any rows selected = only those rows are the effective target

#### Button set — replace BulkButton inline styles with shared `Button` from `components/ui/button.tsx`
Remove: "Invite Claude", "Delete All"
New button set (counts reflect effective selection):

| Button | Count shown | Variant | API | Condition to show |
|---|---|---|---|---|
| Create League (N) | members without active/pending workspace | `default` | `bulk-provision { accountType: 'workspace' }` | always |
| Remove League (N) | members with active workspace | `destructive` | `bulk-remove-all` | always |
| Suspend (N) | non-suspended members | `outline` | `bulk-suspend-all` | always |
| Grant LLM Proxy (N) | members without active proxy | `default` | `llm-proxy/bulk-grant` | always |
| Revoke LLM Proxy (N) | members with active proxy | `outline` | `llm-proxy/bulk-revoke` | **only if ≥1 member has a proxy** |

All buttons pass `userIds: [...selectedIds]` in the request body when selection is non-empty; omit `userIds` when none selected (backend acts on full group).

#### LLM Proxy column
- Add **LLM Proxy** as a new column in the member table (after Claude column)
- Show a `StatusPill` (active/pending/none) based on proxy data returned by the members endpoint
- Requires backend change (see §8)

#### Remove per-row "Remove" button
- The "Remove" button per row is removed; removal from group is no longer exposed here

### 5. SyncPanel.tsx — Remove Claude section
- Remove the entire Anthropic/Claude card (the third bordered section)
- Remove the `useEffect` that calls `GET /api/admin/anthropic/probe` on mount
- Remove all Claude-sync state: `probeResult`, `claudeSyncReport`, `claudeSyncing`, etc.
- Keep Pike13 and Google Workspace sections unchanged

---

## Backend Changes

### 6. Cohorts route — add member count
In `prisma.cohort.findMany()`, add:
```typescript
include: { _count: { select: { users: true } } }
```
Update the response type/serialization to expose `memberCount: number` (from `_count.users`).

### 7. Group bulk-action routes — accept optional `userIds`
For each of these endpoints: `bulk-provision`, `bulk-suspend-all`, `bulk-remove-all`, `llm-proxy/bulk-grant`, `llm-proxy/bulk-revoke`:
- Accept optional `userIds?: string[]` in request body
- When provided, add `userId: { in: userIds }` filter to the Prisma query (scoped within the group)
- When omitted, existing behavior (all group members)

### 8. Group members endpoint — add LLM proxy status
In `GET /api/admin/groups/:id/members` (or wherever member data is assembled):
- For each member, include their `llmProxyToken` status: active/pending/none
- This lets the frontend compute Grant/Revoke counts and render the LLM Proxy column

---

## Verification
1. Log in as admin; confirm nav order: Dashboard → Users → Groups → Cohorts → Sync → Provisioning Requests; no Account or Merge Queue link
2. Dashboard shows User Counts card first, no Cohorts widget
3. Cohorts list shows a Students count column with correct numbers
4. Groups detail:
   - Group name is click-to-edit (no Edit button)
   - Checkboxes present; selecting rows updates button counts; no rows selected = counts reflect all members
   - Buttons use the shared Button component (no garish inline colors); no "Invite Claude" or "Delete All"
   - "Revoke LLM Proxy" button absent when no member has a proxy
   - LLM Proxy column visible in member table
5. Sync page shows only Pike13 and Google Workspace sections
