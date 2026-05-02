---
status: pending
---

# Sprint 021 (proposed): sidebar cleanup — kill Services page, promote individual services, group user management, stop the admin morph

## Context

Sprint 020 just shipped a sidebar with role-gated app menu items
(`APP_NAV` in `client/src/components/AppLayout.tsx`). Stakeholder
review finds it confusing:

1. **Services page is empty** when clicked — the consolidated zones
   either aren't gating correctly or the user genuinely has no
   entitlements that survive the consolidation. Either way, a single
   "Services" link is the wrong UX. Each service the user actually
   has should be its own sidebar item.
2. **Account is duplicated** — it's a top-level sidebar item AND a
   user-menu dropdown item.
3. **Sidebar morphs on `/admin/*`** — clicking "User Management"
   navigates to `/admin/users`, which swaps `ADMIN_NAV` in for the
   normal nav, dragging in Audit Log, Environment, Database,
   Sessions, Configuration, Logs, Scheduler, Import/Export. The
   stakeholder explicitly said this morph "shouldn't do that."
4. **User-related pages are scattered** — Staff Directory, User
   Management, Cohorts, Groups, plus admin Users / League Students /
   LLM Proxy users — all sitting at the top level of the sidebar.

Goal of this sprint: **one stable sidebar, no morphing on `/admin/*`,
proper grouping**.

---

## Current sidebar

### Main app sidebar (staff user, not on `/admin/*`)
`APP_NAV` (always visible, role-gated):
- Account
- Services
- OAuth Clients
- Staff Directory       *(staff/admin)*
- User Management → `/admin/users`  *(staff/admin)*
- Cohorts               *(admin)*
- Groups                *(admin)*

`ADMIN_WORKFLOW_NAV` (admin only, when not on `/admin/*`):
- Dashboard → `/`
- Users → `/users` (children: League Students, LLM Proxy)
- Sync → `/sync`

### Admin sidebar (anyone on `/admin/*`) — `ADMIN_NAV` REPLACES the workflow section
- Users → `/admin/users`
- Audit Log
- Environment
- Database
- Configuration
- Logs
- Sessions
- Scheduled Jobs
- Import/Export

---

## Target sidebar (decided)

Single nav, **stable across all routes**. No section swap on `/admin/*`.

```
[OAuth Clients]                        all auth users

[Claude Code]                          per-user entitlement
[LLM Proxy]                            per-user entitlement

[User Management] ▾                    staff/admin
  ├── Staff Directory                  staff/admin   (default child — clicked group lands here)
  ├── Users                            admin         (folded: today's /users + /admin/users)
  ├── League Students                  admin
  ├── LLM Proxy Users                  admin
  ├── Cohorts                          admin
  └── Groups                           admin

[Dashboard]                            admin (top level)
[Sync]                                 admin (top level)

[Admin] ▾                              admin (collapsible group, never morphs)
  ├── Audit Log
  ├── Environment
  ├── Database
  ├── Configuration
  ├── Logs
  ├── Sessions
  ├── Scheduled Jobs
  └── Import/Export

— bottom —
About
```

User-menu dropdown (avatar in sidebar): **Account**, Log out.
*(unchanged — Account leaves the sidebar but stays in the dropdown)*

---

## Decisions (from stakeholder Q&A)

- **Services page is DELETED.** No consolidated landing.
- **Claude Code → its own sidebar item.** New page
  `client/src/pages/ClaudeCode.tsx` mounted at `/claude-code` under
  `AppLayout`, content moved from `Services.tsx`'s `ClaudeCodeSection`.
  Sidebar item visible only when the user is entitled (same predicate
  the old `ClaudeCodeSection` used).
- **LLM Proxy → its own sidebar item.** New page
  `client/src/pages/LlmProxy.tsx` mounted at `/llm-proxy` under
  `AppLayout`, content moved from `Services.tsx`'s `LlmProxySection`
  (the existing `AccountLlmProxyCard` component is the right shape to
  reuse). Sidebar item visible only when `account.llmProxyEnabled === true`.
- **Workspace temp-password surfacing → back on Account page.** It
  was on Account before sprint 020; restore that block so the
  one-time onboarding signal isn't lost.
- **Account is removed from `APP_NAV`.** Already in the user-menu
  dropdown.
- **User Management is a collapsible group.** Click on the header
  expands AND navigates to the default child (Staff Directory).
- **Users (admin), League Students, LLM Proxy users folded into
  User Management.** No separate top-level "Users" group.
- **`/users` and `/admin/users` are consolidated.** They overlap;
  collapse to one canonical page (whichever is more complete) under
  the User Management group. Keep the other path as a redirect for
  one release.
- **Dashboard and Sync stay at top level (admin only).**
- **Admin operational pages live in a collapsible "Admin" group.**
  No more morph: the rest of the sidebar stays put when navigating
  inside `/admin/*`. The `isAdminSection` branch in `AppLayout.tsx`
  is removed.

---

## Implementation outline (tickets, draft)

1. **Strip morph + restructure `AppLayout.tsx`**
   - Remove `isAdminSection` branch and `ADMIN_NAV` swap.
   - Replace `APP_NAV` + `ADMIN_WORKFLOW_NAV` + `ADMIN_NAV` with a
     single nav config supporting collapsible groups with a
     default-child link target.
   - Add collapse/expand state (per group, persisted in
     `localStorage` is nice-to-have).
   - Remove `Account` and `Services` items from sidebar.
   - Add `Claude Code` and `LLM Proxy` items, gated on entitlement.
   - Build the User Management group (default child Staff Directory).
   - Build the Admin group (Audit Log … Import/Export).

2. **New pages: ClaudeCode.tsx and LlmProxy.tsx**
   - Move `ClaudeCodeSection` content from `Services.tsx` →
     `client/src/pages/ClaudeCode.tsx`. Mount `/claude-code` under
     `AppLayout` in `App.tsx`.
   - Move `LlmProxySection` content (or import
     `AccountLlmProxyCard`) → `client/src/pages/LlmProxy.tsx`. Mount
     `/llm-proxy` under `AppLayout`.

3. **Restore Workspace temp-password block on Account.tsx**
   - Re-introduce the `WorkspaceTempPasswordCard` (or whatever the
     old block was called) in `Account.tsx`. Source it from
     `Services.tsx` before deletion.

4. **Delete Services**
   - Delete `client/src/pages/Services.tsx`,
     `tests/client/pages/Services.test.tsx`.
   - Remove `/services` route from `App.tsx`.

5. **Consolidate `/users` and `/admin/users`**
   - Decide canonical page (likely `AdminUsersPanel` since it lives
     behind the backend `/api/admin/check` gate). Move it to a single
     route, e.g. `/users` under `AppLayout` with role-gating, and
     redirect the other.
   - Update affected tests.

6. **Sidebar tests**
   - Rewrite `tests/client/AppLayout.test.tsx` to assert the new
     structure, the no-morph behaviour, and the click-group-navigates
     -to-default-child behaviour for User Management.

7. **Manual smoke (sprint 020 style)**
   - As student / staff / admin: each role sees the correct items;
     Claude Code and LLM Proxy show up only when entitled; navigating
     into `/admin/*` does not change the sidebar; User Management
     expands and lands on Staff Directory; OAuth Clients works for
     everyone.

---

## Critical files

- `client/src/components/AppLayout.tsx` — primary nav arrays + morph
  logic + collapse/expand state.
- `client/src/lib/roles.ts` — `hasAdminAccess`, `hasStaffAccess` (no
  changes expected; reuse).
- `client/src/App.tsx` — add `/claude-code`, `/llm-proxy`, drop
  `/services`, consolidate `/users` ↔ `/admin/users`.
- `client/src/pages/Services.tsx` — delete (after extracting
  Workspace block to Account and Claude/LLM blocks to their own
  pages).
- `client/src/pages/Account.tsx` — restore Workspace temp-password
  block.
- `client/src/pages/ClaudeCode.tsx` — new.
- `client/src/pages/LlmProxy.tsx` — new (reuse
  `client/src/pages/account/AccountLlmProxyCard.tsx`).
- `client/src/pages/admin/AdminUsersPanel.tsx` and
  `client/src/pages/UsersPanel.tsx` — pick canonical, redirect the
  other.
- `tests/client/AppLayout.test.tsx` — substantial rewrite.
- `tests/client/pages/Services.test.tsx` — delete.
- New: `tests/client/pages/ClaudeCode.test.tsx`,
  `tests/client/pages/LlmProxy.test.tsx`.

## Verification

- `npm run test:client` — all sidebar tests pass against the new
  structure; baseline holds (~241 + new tests, ~34 pre-existing
  failures unchanged).
- `npm run test:server` — unchanged (no server work in this sprint),
  baseline ~1623/1624.
- Manual smoke: log in as student, staff, admin and walk the
  sidebar. Verify entitlement-gated items appear/disappear; verify
  no morph on `/admin/*`; verify User Management group expand-and-
  navigate behaviour.

---

## Out of scope

- New permissions/role concepts (use existing `hasAdminAccess`,
  `hasStaffAccess`, and entitlement flags already on the account
  profile).
- Server-side route or service changes (this is a client-only
  cleanup sprint).
- Visual / theme changes beyond what the new layout requires.
