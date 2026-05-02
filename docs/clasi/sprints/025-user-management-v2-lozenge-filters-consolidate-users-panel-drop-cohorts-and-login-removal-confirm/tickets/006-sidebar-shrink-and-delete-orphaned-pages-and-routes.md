---
id: '006'
title: Sidebar shrink and delete orphaned pages and routes
status: done
use-cases:
- SUC-005
depends-on:
- '005'
github-issue: ''
todo: ''
completes_todo: false
---

# Sidebar shrink and delete orphaned pages and routes

## Description

After ticket 005, the unified Users page covers all use cases previously
served by StudentAccountsPanel, LlmProxyUsersPanel, StaffDirectory, and the
Cohorts pages. Those pages and their routes can now be safely deleted.

The sidebar User Management group currently has six children. This ticket
trims it to two: "User Management" (→ /admin/users) and "Groups" (→ /groups).

This is the final cleanup step before the smoke test.

## Acceptance Criteria

**Sidebar:**
- [x] `SIDEBAR_NAV` User Management group children contain exactly two entries: `{ to: '/admin/users', label: 'User Management' }` and `{ to: '/groups', label: 'Groups' }`.
- [x] Students, Staff, LLM Proxy Users, and Cohorts entries are removed from the children array.
- [x] `defaultTo` remains `/admin/users`.

**Deleted page files:**
- [x] `client/src/pages/admin/StudentAccountsPanel.tsx` is deleted.
- [x] `client/src/pages/admin/LlmProxyUsersPanel.tsx` is deleted.
- [x] `client/src/pages/staff/StaffDirectory.tsx` is deleted.
- [x] `client/src/pages/admin/Cohorts.tsx` is deleted.
- [x] `client/src/pages/admin/CohortDetailPanel.tsx` is deleted (if it exists as a separate file; it may be defined inline in Cohorts.tsx).

**Deleted test files:**
- [x] Test files for the above pages are deleted (search `tests/client/` for matching file names).

**Deleted routes (App.tsx):**
- [x] Routes for `/users/students`, `/users/llm-proxy`, `/staff/directory`, `/cohorts`, and `/cohorts/:id` are removed from `App.tsx`.
- [x] TypeScript compilation passes after deletions (`npm run build` or `tsc --noEmit`).
- [x] No remaining imports of the deleted page components anywhere in the codebase.

## Implementation Plan

### Approach

1. Shrink `SIDEBAR_NAV` children in `AppLayout.tsx` to the two entries listed above.
2. Delete the five page files (verify each exists via `ls` first).
3. Search `tests/client/` for test files for those pages and delete them.
4. Remove the five route definitions from `App.tsx`.
5. Run `grep -r "StudentAccountsPanel\|LlmProxyUsersPanel\|StaffDirectory\|CohortDetailPanel" client/src/` to confirm no remaining imports.
6. Run `npm run build` (or `tsc --noEmit`) to confirm clean compilation.

### Files to modify

- `client/src/components/AppLayout.tsx` — shrink User Management children
- `client/src/App.tsx` — remove five route definitions

### Files to delete

- `client/src/pages/admin/StudentAccountsPanel.tsx`
- `client/src/pages/admin/LlmProxyUsersPanel.tsx`
- `client/src/pages/staff/StaffDirectory.tsx`
- `client/src/pages/admin/Cohorts.tsx`
- `client/src/pages/admin/CohortDetailPanel.tsx` (if separate file)
- Test files for any of the above found under `tests/client/`

### Testing plan

- Run full client test suite after deletions: `npm run test:client`. All tests should pass; deleted test files obviously will not run.
- Run TypeScript compilation check: `npx tsc --noEmit` in the `client/` directory.
- Verify sidebar in the browser (smoke test ticket 007 will confirm this).

### Documentation updates

None required.
