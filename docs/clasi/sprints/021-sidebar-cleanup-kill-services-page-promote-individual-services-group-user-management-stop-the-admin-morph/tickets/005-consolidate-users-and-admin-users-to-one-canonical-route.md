---
id: "005"
title: "Consolidate /users and /admin/users to one canonical route"
status: todo
use-cases:
  - SUC-004
  - SUC-005
depends-on:
  - "001"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Consolidate /users and /admin/users to one canonical route

## Description

Two routes currently exist for listing all users:

- `/users` — renders `UsersPanel` (from `pages/admin/UsersPanel.tsx`), gated by `AdminOnlyRoute`.
- `/admin/users` — renders `AdminUsersPanel` (from `pages/admin/AdminUsersPanel.tsx`), gated by `AdminLayout`.

The sidebar User Management group (ticket 001) links to `/admin/users`. The old
`/users` route from `ADMIN_WORKFLOW_NAV` becomes orphaned. Consolidate to one
canonical path by adding a React Router redirect.

### Canonical choice: `/admin/users` with `AdminUsersPanel`

`AdminUsersPanel` is the richer implementation (impersonation, role edits,
access via `/api/admin/check` gate). The sidebar links to it directly. The
`/users` route redirects to `/admin/users`.

Sub-paths of `/users` (`/users/students`, `/users/llm-proxy`, `/users/:id`)
continue to exist unchanged — only the exact `/users` path redirects.

`UsersPanel.tsx` is left in place (it is still referenced by the `/users`
sub-paths implicitly — actually `/users/students` uses `StudentAccountsPanel`
and `/users/llm-proxy` uses `LlmProxyUsersPanel`). Only the root `/users` route
changes. `UsersPanel.tsx` itself may be a dead file after this change —
the implementor should check whether anything still imports it. If nothing does,
it may be deleted; otherwise leave it.

## Acceptance Criteria

- [ ] Navigating to `/users` redirects to `/admin/users` (React Router `<Navigate replace />`).
- [ ] `/admin/users` still renders `AdminUsersPanel` correctly.
- [ ] `/users/students`, `/users/llm-proxy`, and `/users/:id` sub-paths are unaffected.
- [ ] The sidebar User Management "Users" child item links to `/admin/users`.
- [ ] `npm run test:client` passes.

## Implementation Plan

### Approach

In `client/src/App.tsx`, within the `AdminOnlyRoute` block, change the `/users`
route from:

```tsx
<Route path="/users" element={<UsersPanel />} />
```

to:

```tsx
<Route path="/users" element={<Navigate to="/admin/users" replace />} />
```

Keep all `/users/students`, `/users/llm-proxy`, `/users/:id` routes unchanged
(they are separate `<Route>` entries and are not affected).

After the change, check whether `UsersPanel` is imported anywhere else. If the
only import was for the `/users` route, remove the import too (and optionally
delete `UsersPanel.tsx`).

### Files to modify

- `client/src/App.tsx` — change `/users` route to a redirect

### Files to audit

- `client/src/pages/admin/UsersPanel.tsx` — check for other callers; delete if orphaned

### Testing plan

- Run `npm run test:client`.
- If any tests render the `/users` route and expect `UsersPanel` content, they
  will need to be updated to expect the redirect or to navigate to `/admin/users`
  instead. Flag any such test failures for ticket 006.

### Documentation updates

None — architecture-update.md already documents the redirect decision.
