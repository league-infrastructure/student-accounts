---
id: '006'
title: GroupDetailPanel drop bulk-action toolbar selection column and GrantLlmProxyModal
status: done
use-cases:
- SUC-007
depends-on:
- '005'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GroupDetailPanel drop bulk-action toolbar selection column and GrantLlmProxyModal

## Description

Remove the bulk-action toolbar and all associated code from `GroupDetailPanel.tsx`. The five
bulk-action buttons (Create League, Remove League, Suspend, Grant LLM Proxy, Revoke LLM Proxy)
are redundant now that per-row permission checkboxes exist (sprint 027). This ticket also removes
the row-selection state, the per-row select checkbox column, the select-all column header, and
the `GrantLlmProxyModal` import and render.

**Depends on ticket 005** — title-row and PassphraseCard changes must be in place so this ticket
has a stable base for the member-table section.

The tri-state column toggles (which provide the "apply to all" replacement behavior) are added
in the following ticket 007.

## Acceptance Criteria

- [x] The five bulk-action buttons (`Create League`, `Remove League`, `Suspend`, `Grant LLM Proxy`, `Revoke LLM Proxy`) no longer render.
- [x] `runBulkProvision`, `runBulkAll`, `runBulkLlmProxyRevoke` handler functions are deleted.
- [x] Count-getter helpers (`getCreateLeagueCount`, `getRemoveLeagueCount`, `getSuspendCount`, `getGrantLlmProxyCount`, `getRevokeLlmProxyCount`) are deleted.
- [x] `LlmProxyGrantModal` (or `LlmProxyGrantModal`/`GrantLlmProxyModal`) import and render are removed.
- [x] `showGrantModal` state variable is deleted.
- [x] `selectedIds` state variable (and any `setSelectedIds`) is deleted.
- [x] The per-row select `<td>` checkbox column is removed from the member table.
- [x] The select-all `<th>` column header is removed.
- [x] Any `BulkResult` type that is now unused is deleted.
- [x] No references to deleted symbols remain (TypeScript compiles clean).
- [x] Tests asserting on the deleted bulk buttons are removed or updated.
- [x] `npm run test:client -- GroupDetailPanel` passes.

## Implementation Plan

### Approach

In `client/src/pages/admin/GroupDetailPanel.tsx`:

1. Delete the bulk-action `<div>` block (currently lines ~661-700, the `flexWrap: 'wrap'` div with five `<Button>` children).
2. Delete handler functions: search for `runBulkProvision`, `runBulkAll`, `runBulkLlmProxyRevoke` and delete each function declaration.
3. Delete count-getter helpers: search for `getCreateLeagueCount`, `getRemoveLeagueCount`, `getSuspendCount`, `getGrantLlmProxyCount`, `getRevokeLlmProxyCount`.
4. Remove the `LlmProxyGrantModal` (or similar) import line. Remove the `<LlmProxyGrantModal ... />` render if it exists.
5. Delete `const [showGrantModal, setShowGrantModal] = useState(false)` and `const [selectedIds, setSelectedIds] = useState<number[]>([])` state declarations.
6. In the member table `<thead>`: delete the `<th>` for the select-all checkbox.
7. In the member table `<tbody>`: delete the `<td>` select-checkbox cell from each row.
8. Delete `BulkResult` interface if no longer referenced.
9. Run `tsc --noEmit` (or equivalent) to confirm no dangling references.

### Files to Modify

- `client/src/pages/admin/GroupDetailPanel.tsx` — bulk deletions per above

### Testing Plan

In `tests/client/pages/GroupDetailPanel.test.tsx`:
- Remove any test that queries for or asserts the existence of the five bulk-action buttons.
- Remove any test that asserts on `selectedIds` or selection checkbox behavior.
- Add a smoke-render test: render with a group fixture and assert none of the deleted button labels appear in the output.
- Verify the existing permission-checkbox tests (from sprint 027) still pass.

Run: `npm run test:client -- GroupDetailPanel`
