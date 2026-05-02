---
id: '001'
title: Strip morph and restructure AppLayout nav
status: done
use-cases:
- SUC-001
- SUC-004
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Strip morph and restructure AppLayout nav

## Description

Replace the three nav arrays (`APP_NAV`, `ADMIN_WORKFLOW_NAV`, `ADMIN_NAV`)
and the `isAdminSection` branch in `client/src/components/AppLayout.tsx` with
a single `SIDEBAR_NAV` configuration. The new config supports two item shapes:
a flat link item (with optional role/entitlement gate) and a collapsible group
item (with a default-child link target and child items).

The sidebar must be identical regardless of the current URL — navigating into
`/admin/*` must NOT change what nav items are visible.

### New SIDEBAR_NAV structure (target)

```
[OAuth Clients]           all auth users
[Claude Code]             gate: account has claude ExternalAccount
[LLM Proxy]               gate: account.llmProxyEnabled === true
[User Management] ▾       gate: hasStaffAccess — default child /staff/directory
  ├── Staff Directory     hasStaffAccess → /staff/directory
  ├── Users               hasAdminAccess → /admin/users (canonical)
  ├── League Students     hasAdminAccess → /users/students
  ├── LLM Proxy Users     hasAdminAccess → /users/llm-proxy
  ├── Cohorts             hasAdminAccess → /cohorts
  └── Groups              hasAdminAccess → /groups
[Dashboard]               hasAdminAccess → /
[Sync]                    hasAdminAccess → /sync
[Admin] ▾                 hasAdminAccess
  ├── Audit Log           → /admin/audit-log
  ├── Environment         → /admin/env
  ├── Database            → /admin/db
  ├── Configuration       → /admin/config
  ├── Logs                → /admin/logs
  ├── Sessions            → /admin/sessions
  ├── Scheduled Jobs      → /admin/scheduler
  └── Import/Export       → /admin/import-export
```

Bottom nav: About (unchanged).

User-menu dropdown: Account, Log out (unchanged — Account is NOT in sidebar).

### Entitlement gates for Claude Code and LLM Proxy

`AppLayout` must fetch `/api/account` via `useQuery(['account'])` — the same
React Query cache key that `Account.tsx` uses — to avoid double fetches. While
account data is loading, treat both entitlement-gated items as hidden.

### Collapse/expand state

Each collapsible group tracks its own `expanded` boolean in component state.
Default: collapsed, with auto-expand when the current path is a child of the
group. `localStorage` persistence is a nice-to-have — omit if it adds
significant complexity.

### What to remove

- `APP_NAV`, `ADMIN_WORKFLOW_NAV`, `ADMIN_NAV`, `MAIN_NAV` constant arrays.
- `isAdminSection` variable and all branches that use it.
- The "Back to App" mode-switch `NavLink` at the top of the sidebar.
- Account and Services items from the sidebar.
- The bottom-nav Staff Directory and Admin links (they move into groups above).

## Acceptance Criteria

- [x] `SIDEBAR_NAV` is a single array; no `isAdminSection` variable exists anywhere in `AppLayout.tsx`.
- [x] Navigating to `/admin/env` does not change the set of visible sidebar items.
- [x] User Management group is visible to staff and admin roles; hidden for student/unauthenticated.
- [x] Clicking the User Management group header navigates to `/staff/directory` AND expands the group.
- [x] Admin group is visible to admin only and contains all eight ops links.
- [x] Dashboard and Sync are visible to admin only as flat items.
- [x] OAuth Clients item is visible to all authenticated roles.
- [x] Claude Code sidebar item appears only when the user has a `claude` ExternalAccount; absent otherwise.
- [x] LLM Proxy sidebar item appears only when `account.profile.llmProxyEnabled === true`; absent otherwise.
- [x] Account does not appear in the sidebar (remains in user-menu dropdown only).
- [x] Services does not appear in the sidebar.
- [x] Bottom nav still shows About.
- [x] `npm run test:client` passes (pre-existing failures acceptable; AppLayout.test.tsx will be rewritten in ticket 006).

## Implementation Plan

### Approach

1. Add `useQuery<AccountData>({ queryKey: ['account'], queryFn: fetchAccount })`
   in `AppLayout` (after the auth loading guard), where `fetchAccount` is the
   same function used in `Account.tsx` (extract to a shared location or
   duplicate inline — implementor's judgment).
2. Define a discriminated union type for nav items:
   ```ts
   type SidebarItem =
     | { kind: 'link'; to: string; label: string; end?: boolean;
         gate?: (role: string | undefined, account: AccountData | undefined) => boolean }
     | { kind: 'group'; label: string; defaultTo: string;
         gate?: (role: string | undefined) => boolean;
         children: Array<{ to: string; label: string; end?: boolean;
           gate?: (role: string | undefined) => boolean }> }
   ```
3. Define `SIDEBAR_NAV: SidebarItem[]` with the structure shown above.
4. Add per-group expand/collapse state using `useState<Record<string, boolean>>({})`.
5. Replace the old multi-section nav JSX with a single `SIDEBAR_NAV.map(...)` loop.
6. For group items: render a clickable `<div>` header that calls
   `navigate(item.defaultTo)` and toggles expanded state. Render children when
   `expanded[item.label]` or when current path starts with any child `to`.
7. Remove all dead code (old arrays, `isAdminSection`, mode-switch link).

### Files to modify

- `client/src/components/AppLayout.tsx` — primary changes

### Files left for other tickets

- `client/src/App.tsx` — route changes in tickets 002, 004, 005
- `tests/client/AppLayout.test.tsx` — rewritten in ticket 006

### Testing plan

- Run `npm run test:client` after changes to confirm no new unexpected failures.
- Existing `AppLayout.test.tsx` will have failures from changed nav items —
  these are expected and will be fixed in ticket 006, not here.

### Documentation updates

None — architecture-update.md already documents this change.
