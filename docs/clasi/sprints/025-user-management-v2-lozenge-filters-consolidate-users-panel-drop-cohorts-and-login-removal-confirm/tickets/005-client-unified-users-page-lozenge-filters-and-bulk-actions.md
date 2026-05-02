---
id: '005'
title: 'Client: unified Users page lozenge filters and bulk actions'
status: done
use-cases:
- SUC-002
- SUC-003
- SUC-004
- SUC-006
depends-on:
- '003'
github-issue: ''
todo: ''
completes_todo: false
---

# Client: unified Users page lozenge filters and bulk actions

## Description

`AdminUsersPanel.tsx` currently uses a `<FilterDropdown>` that supports one
active filter at a time and includes a cohort-filter branch. This ticket
replaces it with two lozenge filter bars and adds two bulk actions (suspend
accounts, revoke LLM proxy) migrated from the soon-to-be-deleted panels.

The Cohort column is also removed from the table. The `AdminUser` type is
extended with `llmProxyEnabled` and `oauthClientCount` (available after
ticket 003 lands).

This ticket does NOT delete the old panels — that is ticket 006. After this
ticket, both old panels and the unified Users page exist; old panels will just
not be linked from the sidebar.

## Acceptance Criteria

**Role lozenge filter (radio group):**
- [x] Four pill buttons rendered above the table: `All | Staff | Admin | Student`.
- [x] Exactly one is active at a time; clicking another deactivates the current one.
- [x] Default: `All`.
- [x] `Staff` shows users where `normalizeRole(role) === 'staff'`.
- [x] `Admin` shows users where `normalizeRole(role) === 'admin'`.
- [x] `Student` shows users where `normalizeRole(role) === 'student'` (no email-domain filter).

**Feature lozenge filter (multi-select toggle group):**
- [x] Five pill buttons rendered on a second row: `Google | Pike 13 | GitHub | LLM Proxy | OAuth Client`.
- [x] Each is independently on/off; multiple may be active simultaneously.
- [x] When multiple are active, results are the intersection (user must match ALL active predicates).
- [x] When none are active, no feature filter applies.
- [x] `Google`: `providers.some(p => p.provider === 'google')`
- [x] `Pike 13`: `externalAccountTypes.includes('pike13')`
- [x] `GitHub`: `providers.some(p => p.provider === 'github')`
- [x] `LLM Proxy`: `llmProxyEnabled === true` (requires ticket 003)
- [x] `OAuth Client`: `oauthClientCount > 0` (requires ticket 003)

**Cohort column:**
- [x] The "Cohort" column header and all cohort cells are removed from the table.
- [x] `cohortLabel`, cohort sort comparator, and cohort chip style are removed.
- [x] The `cohort` query (`GET /api/admin/cohorts`) is no longer fetched.
- [x] Sort columns that referenced cohort are updated (cohort sort option removed from SortCol type).

**Bulk actions:**
- [x] "Suspend accounts" button added to bulk toolbar; calls `POST /api/admin/users/bulk-suspend-accounts` with selected user IDs; guarded by `<ConfirmDialog>` (ticket 001 must be merged first, or ConfirmDialog may be created inline if 001 is in parallel).
- [x] "Revoke LLM Proxy" button added to bulk toolbar; enabled only when at least one selected user has `llmProxyEnabled === true`; calls the LLM proxy bulk-revoke endpoint.
- [x] Both bulk actions show `<ConfirmDialog>` before proceeding.

**Filter removal:**
- [x] The `<FilterDropdown>` component and all references to it are removed from `AdminUsersPanel.tsx`.
- [x] The `FilterOption` type and `filterUsers`/`filterLabel` helpers are removed or replaced by the lozenge filter logic.

## Implementation Plan

### Approach

1. Extend the `AdminUser` interface to add `llmProxyEnabled: boolean` and `oauthClientCount: number`.
2. Remove `FilterDropdown`, `FilterOption`, `filterUsers`, `filterLabel`, `CohortOption`, and the cohort query.
3. Add `RoleFilter = 'all' | 'staff' | 'admin' | 'student'` state and `featureFilters: Set<FeatureToggle>` state.
4. Add `applyRoleFilter` and `applyFeatureFilter` functions. Compose: `const filtered = applySearch(applyFeatureFilter(applyRoleFilter(users, roleFilter), featureFilters), search)`.
5. Remove the Cohort column from the table JSX and the `'cohort'` option from `SortCol`.
6. Add lozenge bar components inline (no separate file needed — ~30 lines each).
7. Add bulk-suspend and bulk-revoke LLM proxy handlers to the bulk toolbar. Import `ConfirmDialog` from `client/src/components/ConfirmDialog.tsx`.
8. Find the LLM proxy bulk-revoke endpoint path by reading `LlmProxyUsersPanel.tsx` before it is deleted.

### Files to modify

- `client/src/pages/admin/AdminUsersPanel.tsx` — major rework per above
- `tests/client/pages/Account.test.tsx` or a new `tests/client/pages/AdminUsersPanel.test.tsx` — update/extend

### Testing plan

- Unit tests for lozenge filter logic:
  - Role: each of `All`, `Staff`, `Admin`, `Student` returns the correct subset.
  - Feature: each toggle individually; two toggles together (intersection); zero toggles (no filter).
  - Student lozenge does NOT filter by email domain (regression from ticket 002).
- Bulk action tests: "Suspend" and "Revoke LLM Proxy" buttons: disabled when no selection; confirm dialog appears before mutation; mutation called on confirm; mutation not called on cancel.
- Run: `npm run test:client`

### Documentation updates

None required.
