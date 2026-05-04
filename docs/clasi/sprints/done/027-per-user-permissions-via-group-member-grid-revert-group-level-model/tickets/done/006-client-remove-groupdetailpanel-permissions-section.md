---
id: '006'
title: 'Client: remove GroupDetailPanel Permissions section'
status: done
use-cases:
- SUC-006
depends-on:
- '005'
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: remove GroupDetailPanel Permissions section

## Description

`GroupDetailPanel.tsx` contains a "Permissions" section (lines ~654-698)
added in sprint 026. It renders three `PermissionToggleRow` controls wired
to a separate `permissionsQuery` (fetching `GET /admin/groups/:id` for the
group-level flags) and a `patchPermission` function that calls
`PATCH /admin/groups/:id`. Now that Group no longer carries permission flags,
this entire section and all supporting code must be deleted.

## Acceptance Criteria

- [x] `permissionsQuery` state and its `useQuery` call are removed.
- [x] `GroupPermissions` interface is removed.
- [x] `patchPermission` function is removed.
- [x] `PermissionToggleRow` subcomponent is removed.
- [x] `leagueAccountPending` and `permPatchError` state variables are removed.
- [x] `permSectionStyle` CSS constant is removed.
- [x] The Permissions section JSX block (`{permissionsQuery.data && ...}`) is removed.
- [x] No dead imports remain.
- [x] The component renders without errors; no console warnings or TypeScript errors.

## Implementation Plan

### Approach

Open `GroupDetailPanel.tsx` and delete the identified blocks:
- `GroupPermissions` interface (~lines 45-49).
- `permissionsQuery` useQuery call (~lines 113-126).
- `permPatchError` and `leagueAccountPending` state (~lines 128-129).
- `patchPermission` async function (~lines 458-480).
- The JSX `{permissionsQuery.data && ...}` permissions section (~lines 654-698).
- `PermissionToggleRow` component definition (~lines 879-923).
- `permSectionStyle` CSS constant (~lines 997-1002).

### Files to Modify

- `client/src/pages/admin/GroupDetailPanel.tsx` — remove Permissions section and all supporting code.

### Testing Plan

- Update `tests/client/pages/admin/GroupDetailPanel.test.tsx` (if it exists):
  - Remove any assertions on the "Permissions" section.
  - Confirm the component renders a group with members without error.
- Run `npm run test:client`.

### Documentation Updates

None required.
