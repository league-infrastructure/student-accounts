---
id: '001'
title: "Sidebar restructure \u2014 reorder and relabel User Management group"
status: done
use-cases:
- SUC-001
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---

# Sidebar restructure — reorder and relabel User Management group

## Description

Update `SIDEBAR_NAV` in `AppLayout.tsx` so the User Management group
reflects the stakeholder's intended hierarchy. Two labels are renamed and
the children are reordered. No route paths change.

Current order and labels:

```
Staff Directory   → /staff/directory  (gate: hasStaffAccess)
Users             → /admin/users      (gate: hasAdminAccess)
League Students   → /users/students   (gate: hasAdminAccess)
LLM Proxy Users   → /users/llm-proxy  (gate: hasAdminAccess)
Cohorts           → /cohorts          (gate: hasAdminAccess)
Groups            → /groups           (gate: hasAdminAccess)
```

Target order and labels:

```
Users             → /admin/users      (gate: hasAdminAccess)
Students          → /users/students   (gate: hasAdminAccess)
Staff             → /staff/directory  (gate: hasStaffAccess)
LLM Proxy Users   → /users/llm-proxy  (gate: hasAdminAccess)
Groups            → /groups           (gate: hasAdminAccess)
Cohorts           → /cohorts          (gate: hasAdminAccess)
```

Also update `defaultTo` on the group from `/staff/directory` to
`/admin/users` so that clicking the "User Management" group header
navigates admins to the primary list.

## Acceptance Criteria

- [x] User Management children appear in the order: Users, Students, Staff,
      LLM Proxy Users, Groups, Cohorts.
- [x] Label "Staff Directory" is replaced by "Staff".
- [x] Label "League Students" is replaced by "Students".
- [x] Groups and Cohorts are swapped (Groups before Cohorts).
- [x] The group `defaultTo` is `/admin/users`.
- [x] Gate predicates on each item are unchanged.
- [x] All existing route paths are unchanged.
- [x] `npm run test:client` passes with updated assertions for new labels
      and order.

## Implementation Plan

### Approach

Edit the `SIDEBAR_NAV` constant in
`client/src/components/AppLayout.tsx`. The change is purely data —
reorder the `children` array and update two `label` strings and
`defaultTo`.

### Files to Modify

- `client/src/components/AppLayout.tsx` — reorder children array,
  rename labels, update `defaultTo`.
- `tests/client/AppLayout.test.tsx` — update tests that assert on:
  - "Staff Directory" label → "Staff"
  - "League Students" label → "Students"
  - The expansion test that asserts all six children by name (in order)

### Testing Plan

1. Update `AppLayout.test.tsx` assertions:
   - `shows Staff Directory after expanding User Management group` →
     rename to `shows Staff after expanding` and update the label.
   - `shows all User Management children after expanding the group` →
     update expected labels: "Staff" not "Staff Directory",
     "Students" not "League Students"; assert the correct order.
   - Any test that checks `defaultTo` navigation behavior.
2. Run `npm run test:client` to confirm no regressions.
3. Manual: open the app, expand User Management, confirm order and labels.

### Documentation Updates

Architecture update already describes this change. No further docs needed.
