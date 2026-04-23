---
sprint: "014"
status: active
---

# Architecture Update — Sprint 014: Admin UI Refresh

## Overview

Sprint 014 performs surgical UI cleanup across the admin console: reordering navigation, removing unused widgets and features, and redesigning the group management workflow with per-row selection and LLM proxy visibility. Backend changes are minimal and backward-compatible: response shape additions (no breaking changes) and an optional userIds filter for bulk-action endpoints.

## Components Changed

### Frontend

#### 1. **AppLayout.tsx** — Navigation Reordering
- Reorder ADMIN_WORKFLOW_NAV: Dashboard → Users → Groups → Cohorts → Sync → Provisioning Requests
- Remove "Account" link (users access Account via user-area dropdown at bottom)
- Remove "Merge Queue" link

**Rationale**: Focus navigation on primary admin workflows; less-used features move to bottom or user area.

#### 2. **Dashboard.tsx** — Widget Cleanup
- Move `UserCountsWidget` to first position (currently last)
- Remove `CohortsWidget` entirely: delete import, remove from JSX, remove `GET /api/admin/cohorts` fetch
- Final order: UserCounts → PendingUsers → PendingRequests

**Rationale**: UserCounts is most important for rapid assessment; CohortsWidget duplicates the Cohorts page.

#### 3. **Cohorts.tsx** — Student Count Column
- Add a **Students** column to the cohorts table (after cohort name)
- Backend returns `memberCount: number` (from `_count.users`); display as plain number
- Integrates with backend change (Ticket 001)

**Rationale**: Admins need visibility into cohort size without clicking into each cohort.

#### 4. **SyncPanel.tsx** — Remove Claude Section
- Delete the Anthropic/Claude card (third bordered section)
- Remove the `useEffect` that calls `GET /api/admin/anthropic/probe` on mount
- Remove all Claude-sync state: `probeResult`, `claudeSyncReport`, `claudeSyncing`, etc.
- Keep Pike13 and Google Workspace sections unchanged

**Rationale**: Claude sync is no longer a core feature; removing it simplifies the Sync UI.

#### 5. **GroupDetailPanel.tsx** — Major Redesign

##### 5a. Group name: click-to-edit
- Remove the separate Edit/Save/Cancel button row
- Make the `<h2>` group name clickable
- Click → `<input>` field; Enter or blur → PATCH saves; Escape cancels

##### 5b. Row selection
- Add select-all checkbox in table header (indeterminate when partial selection)
- Add per-row checkbox as first column in member table
- Track `selectedIds: Set<string>` in component state
- **Semantics**: No rows selected = all members are the effective target; any rows selected = only those are the target

##### 5c. Button redesign
- Replace BulkButton inline styles with shared `Button` component from `components/ui/button.tsx`
- New button set (counts reflect effective selection):

| Button | Shows count of | Condition to show |
|--------|---|---|
| Create League (N) | members without active/pending workspace | Always |
| Remove League (N) | members with active workspace | Always |
| Suspend (N) | non-suspended members | Always |
| Grant LLM Proxy (N) | members without active proxy | Always |
| Revoke LLM Proxy (N) | members with active proxy | **Only if ≥1 has proxy** |

- Remove: "Invite Claude", "Delete All" buttons
- Remove per-row "Remove" button (removal now via "Remove League" bulk action)

##### 5d. LLM Proxy column
- Add **LLM Proxy** column after Claude column in member table
- Show `StatusPill` (active/pending/none) based on `member.llmProxyToken` returned by members endpoint
- Integrates with backend change (Ticket 002)

**Rationale**: Click-to-edit reduces friction; row selection enables efficient bulk actions; LLM proxy visibility is critical for access management.

### Backend

#### 6. **Cohorts Endpoint** (`server/src/routes/admin/cohorts.ts` or equivalent)
- In `prisma.cohort.findMany()`, add:
  ```typescript
  include: { _count: { select: { users: true } } }
  ```
- Update response type to expose `memberCount: number` (computed from `_count.users`)
- Example response:
  ```json
  {
    "id": "cohort-123",
    "name": "Cohort A",
    "memberCount": 42,
    ...
  }
  ```

**Rationale**: Gives frontend the cohort student count without an extra API call.

#### 7. **Group Members Endpoint** (`server/src/routes/admin/groups.ts` or equivalent)
- For `GET /api/admin/groups/:id/members`:
  - Include each member's `llmProxyToken` status in the response
  - Compute status: active (non-null, non-expired), pending, or none
  - Example response:
    ```json
    {
      "id": "member-123",
      "name": "Student Name",
      "llmProxyToken": { "status": "active" },
      ...
    }
    ```

**Rationale**: Frontend needs to know proxy status to compute button counts and render the column.

#### 8. **Group Bulk-Action Routes** (e.g., `bulk-provision`, `bulk-suspend-all`, `bulk-remove-all`, `llm-proxy/bulk-grant`, `llm-proxy/bulk-revoke`)
- Accept optional `userIds?: string[]` in request body
- When provided, add `userId: { in: userIds }` Prisma filter (scoped within the group)
- When omitted, existing behavior (all group members)
- Example request:
  ```json
  {
    "userIds": ["user-1", "user-2"]
  }
  ```

**Rationale**: Enables frontend to limit bulk actions to selected members; backward-compatible (userIds is optional).

## Data Model

No schema changes. All backend changes are response shape additions or optional request body fields.

## State Management

- **Frontend**: Row selection state (`selectedIds: Set<string>`) is local to GroupDetailPanel component
- **Backend**: No new state; all changes are read or optional filter parameters

## Dependencies

- No new npm packages
- Uses existing `components/ui/button.tsx` shadcn/ui Button component
- Uses existing `StatusPill` component for LLM proxy status display

## Backward Compatibility

All changes are backward-compatible:
- Cohorts endpoint adds a new field; old clients ignore it
- Group members endpoint adds a new field; old clients ignore it
- Bulk-action endpoints accept an optional field; omitting it uses the original behavior

## Migration Concerns

**None**. No database changes, no breaking API changes, no deployment sequencing required.

## Testing Strategy

1. **Unit Tests**: Button count logic (various member states and selection scenarios)
2. **Integration Tests**: Bulk-action endpoints with and without userIds filter
3. **Component Tests**: Click-to-edit flow, row selection state, indeterminate checkbox
4. **Manual Verification**: 
   - Navigation order correct
   - Dashboard shows correct widgets, no 404s
   - Cohorts list shows Students column with correct counts
   - Groups detail: name editable, checkboxes work, button counts update, LLM Proxy column visible
   - SyncPanel shows only Pike13 and Google Workspace

## Risk Assessment

**Low Risk**:
- All changes are UI-focused or backward-compatible API additions
- No database schema changes
- No breaking changes to existing API contracts
- CohortsWidget removal is complete (no lingering references)

**Mitigations**:
- Thorough manual verification of removed features (CohortsWidget, Claude card)
- Test button count logic across edge cases (empty selection, all selected, partial)
- Verify bulk actions correctly respect userIds filter
