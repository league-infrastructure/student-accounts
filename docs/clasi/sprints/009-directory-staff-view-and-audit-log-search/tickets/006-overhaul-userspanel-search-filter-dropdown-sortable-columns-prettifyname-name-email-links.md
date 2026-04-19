---
id: '006'
title: 'Overhaul UsersPanel: search, filter dropdown, sortable columns, prettifyName,
  name/email links'
status: done
use-cases:
- SUC-009-001
- SUC-009-004
depends-on:
- '001'
github-issue: ''
todo: ''
---

# Overhaul UsersPanel: search, filter dropdown, sortable columns, prettifyName, name/email links

## Description

Replace the current role-tabs filter in `UsersPanel.tsx` with a search box
and unified Filter dropdown. Add sortable column headers with active-sort
indicators. Render Name and Email cells as `<Link>` to the detail page.
Extract a `prettifyName` utility for `@jointheleague.org` addresses.

This ticket covers the filter/sort/display layer. Row checkboxes and actions
menu are in T007.

## Acceptance Criteria

- [x] Role tabs are removed. A single Filter dropdown replaces them with
      three sections: Role (All, Admin & Staff, Students), Accounts (Google,
      League, Pike13), Cohort (one entry per cohort with `google_ou_path`).
- [x] Section labels in the dropdown are visual headers (non-selectable).
- [x] Dropdown button label reflects the active selection (e.g., "Filter:
      Spring 2025" or "Filter: All").
- [x] Search box appears to the left of the Filter dropdown. Substring match
      on `name + email` within the active filter.
- [x] Cohorts in the dropdown are fetched from `GET /api/admin/cohorts` and
      filtered to only those with `google_ou_path` set.
- [x] Columns Name, Email, Cohort, Admin (checkbox column), Joined are
      sortable. Clicking a sortable header sorts by that column. Clicking
      the active header toggles direction. Active header shows ▲/▼.
- [x] Default sort: Name ascending.
- [x] Name cell renders `prettifyName(user)` as a `<Link to="/admin/users/:id">`.
- [x] Email cell renders as a `<Link to="/admin/users/:id">`.
- [x] `prettifyName` is a pure function in
      `client/src/pages/admin/utils/prettifyName.ts`. For `@jointheleague.org`
      emails with `first.last` local parts, returns `TitleCase First TitleCase Last`.
      Otherwise returns `displayName` or the email local part.
- [x] Admin & Staff filter returns users with `role=admin` OR `role=staff`.
- [x] Accounts > Google: users with at least one Login with `provider=google`.
- [x] Accounts > League: users with `externalAccountTypes` including `workspace`.
- [x] Accounts > Pike13: users with `externalAccountTypes` including `pike13`.
- [x] Cohort filter: students in that cohort.
- [x] Empty-result message: "No users match this filter."
- [x] Frontend unit tests for `prettifyName` covering: `@jointheleague.org`
      first.last → TitleCase; non-matching email → fallback; null displayName →
      email local part.

## Implementation Plan

**Files to create:**
- `client/src/pages/admin/utils/prettifyName.ts` — pure utility function.

**Files to modify:**
- `client/src/pages/admin/UsersPanel.tsx` — substantial rewrite of the
  rendering and filter/sort state. Data fetching (`fetchUsers`) unchanged.
  Add `externalAccountTypes` to the `AdminUser` interface.

**State additions:**
```typescript
const [search, setSearch] = useState('');
const [activeFilter, setActiveFilter] = useState<FilterOption>({ type: 'all' });
const [sortCol, setSortCol] = useState<SortCol>('name');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
const [cohorts, setCohorts] = useState<{id:number; name:string}[]>([]);
```

**Filter logic:** Client-side filtering over the already-fetched `users` array.
Apply `activeFilter` first, then apply `search` substring match.

**Testing plan:**
- New test: `tests/client/prettifyName.test.ts` — unit tests for the
  `prettifyName` function (no DOM rendering needed).
- Manual: toggle each filter section entry; verify table updates.
- Manual: type in search box; verify rows filter within active filter selection.
- Manual: click each sortable column header; verify sort direction toggles.

**Documentation updates:** None required.
