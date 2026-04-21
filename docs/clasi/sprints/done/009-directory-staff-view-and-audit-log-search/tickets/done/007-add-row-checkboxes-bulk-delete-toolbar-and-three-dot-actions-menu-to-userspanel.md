---
id: "007"
title: "Add row checkboxes, bulk-delete toolbar, and three-dot actions menu to UsersPanel"
status: done
use-cases: [SUC-009-002, SUC-009-003]
depends-on: ["003", "006"]
github-issue: ""
todo: ""
---

# Add row checkboxes, bulk-delete toolbar, and three-dot actions menu to UsersPanel

## Description

Extend the overhauled `UsersPanel.tsx` (T006) with:
1. Row checkboxes and a header toggle-all checkbox for bulk selection.
2. A bulk-action toolbar ("N selected — [Edit] [Delete]") that appears when
   one or more rows are checked.
3. A three-dot (⋮) actions menu per row replacing the separate Impersonate
   button and View link columns. Menu items: Edit (navigate), Delete (confirm
   + call T003 endpoint), Impersonate (existing flow).

Depends on T003 (DELETE endpoint) and T006 (base panel overhaul).

## Acceptance Criteria

- [x] Each non-own-row has a checkbox in the leftmost column. Own row has no
      checkbox.
- [x] Header checkbox toggles all visible (non-own) rows.
- [x] When ≥1 row is checked, a toolbar appears above the table:
      "N selected — [Edit] [Delete]".
- [x] Bulk Delete: confirmation dialog → parallel `DELETE /api/admin/users/:id`
      for each selected user → per-row failures in an error banner; successful
      deletions removed from table; selected set cleared.
- [x] Bulk Edit: stub — clicking does nothing (no alert, no navigation). 
      Future iteration.
- [x] Three-dot menu per row with items: Edit, Delete, Impersonate.
      - Own row: all three are disabled (grayed out, not hidden).
      - Edit: navigate to `/admin/users/:id`.
      - Delete: confirmation dialog → `DELETE /api/admin/users/:id` → row
        removed or error banner.
      - Impersonate: existing `POST /api/admin/users/:id/impersonate` flow.
- [x] Three-dot menu closes on outside click.
- [x] Three-dot menu uses the same dropdown pattern as the user-menu in
      `AppLayout.tsx` — no new dropdown library introduced.
- [x] Separate "Impersonate" button column and "View" link column are removed.
      Both actions are now in the three-dot menu.
- [x] Actions column header is "⋮" (non-sortable).

## Implementation Plan

**Files to modify:**
- `client/src/pages/admin/UsersPanel.tsx` — built on top of T006's output.

**State additions:**
```typescript
const [selected, setSelected] = useState<Set<number>>(new Set());
const [openMenuId, setOpenMenuId] = useState<number | null>(null);
const [bulkDeleting, setBulkDeleting] = useState(false);
const [bulkError, setBulkError] = useState('');
```

**Three-dot menu pattern:** Reuse the click-outside close pattern from
`AppLayout.tsx` (ref + `useEffect` with `mousedown` listener).

**Bulk delete sketch:**
```typescript
async function handleBulkDelete() {
  if (!window.confirm(`Delete ${selected.size} user(s)?`)) return;
  setBulkDeleting(true);
  const results = await Promise.allSettled(
    [...selected].map(id => fetch(`/api/admin/users/${id}`, { method: 'DELETE' }))
  );
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) setBulkError(`${failures.length} deletion(s) failed.`);
  await fetchUsers();
  setSelected(new Set());
  setBulkDeleting(false);
}
```

**Testing plan:**
- Manual: check rows → toolbar appears; Bulk Delete confirms and removes rows.
- Manual: three-dot menu opens on click, closes on outside click.
- Manual: own row's three-dot items are disabled.
- Manual: Edit navigates to detail page; Impersonate flow works.

**Documentation updates:** None required.
