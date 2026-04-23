---
id: '004'
title: 'CohortDetailPanel: trim bulk buttons and wire Suspend All / Delete All'
status: in-progress
use-cases:
- SUC-011-002
depends-on:
- '002'
github-issue: ''
todo: cohort-page-simplify-bulk-buttons.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# CohortDetailPanel: trim bulk buttons and wire Suspend All / Delete All

## Description

Replace the current six per-type bulk buttons on `/cohorts/:id` with
three buttons:

- **Create Claude seats** -- unchanged (invokes existing
  `bulk-provision` for claude).
- **Suspend All** -- new; posts to
  `POST /api/admin/cohorts/:id/bulk-suspend-all`.
- **Delete All** -- new; posts to
  `POST /api/admin/cohorts/:id/bulk-remove-all`.

Drop **Create League**, **Suspend League**, **Suspend Claude**,
**Delete League**, **Delete Claude**. There are no "Create Log"
buttons in the current code.

The succeeded/failed banner continues to use the existing shape and
renders `${userName} (${type}): ${error}` for each failure.

## Acceptance Criteria

- [x] `/cohorts/:id` renders exactly three bulk-action buttons: Create Claude (N), Suspend All, Delete All.
- [x] Create League, Suspend League, Suspend Claude, Delete League, Delete Claude are not rendered.
- [x] Suspend All confirms, posts to `/api/admin/cohorts/:id/bulk-suspend-all`, and displays the succeeded/failed banner.
- [x] Delete All confirms, posts to `/api/admin/cohorts/:id/bulk-remove-all`, and displays the succeeded/failed banner.
- [x] Each failure in the banner shows `type` alongside the user name and error.
- [x] Create Claude seats continues to work unchanged.
- [x] `npm run test:client` passes.

## Plan

### Files to modify
- `client/src/pages/admin/CohortDetailPanel.tsx`

### Approach
1. Keep the existing `runBulk` for provision-claude.
2. Add `runBulkAll(op: 'suspend' | 'remove')` that posts to the new
   endpoints and renders the extended failure shape.
3. Remove the five trimmed buttons; render Create Claude, Suspend
   All, Delete All.
4. Disable Suspend All / Delete All only when no members exist in
   the cohort.

### Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**: None required unless regression appears.
- **Verification command**: `npm run test:client`
