---
id: '021'
title: Sidebar cleanup - kill Services page promote individual services group user
  management stop the admin morph
status: done
branch: sprint/021-sidebar-cleanup-kill-services-page-promote-individual-services-group-user-management-stop-the-admin-morph
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 021: Sidebar cleanup — kill Services page, promote individual services, group user management, stop the admin morph

## Goals

Replace the multi-array, morphing sidebar with a single stable nav configuration.
Promote Claude Code and LLM Proxy from the dead Services page into their own
sidebar items (entitlement-gated). Group all user-management pages under a
collapsible User Management header. Consolidate `/users` and `/admin/users`.
Remove the `isAdminSection` nav-swap entirely so navigating into `/admin/*`
never changes the sidebar shape.

## Problem

Sprint 020 shipped a sidebar that has four structural problems:

1. **Services page is a dead end** — the consolidated Services page either
   gates incorrectly or the user has no entitlements; either way, a single
   "Services" sidebar item is the wrong UX model. Each service should be its
   own item, visible only when the user is entitled.
2. **Account duplicated** — it appears in both the sidebar nav and the
   user-menu dropdown. It belongs only in the dropdown.
3. **Sidebar morphs on `/admin/*`** — clicking "User Management" navigates to
   `/admin/users`, which swaps `ADMIN_NAV` in for the normal nav, pulling in
   Audit Log, Environment, Database, etc. Stakeholder: "that shouldn't do that."
4. **User-related pages scattered** — Staff Directory, User Management,
   Cohorts, Groups, and admin Users / League Students / LLM Proxy users all
   sit at the top level.

## Solution

Replace the three nav arrays (`APP_NAV`, `ADMIN_WORKFLOW_NAV`, `ADMIN_NAV`)
and the `isAdminSection` branch with a single `SIDEBAR_NAV` configuration
that supports flat items and collapsible groups. The new sidebar:

- Is stable across all routes — no section swap on `/admin/*`.
- Surfaces Claude Code and LLM Proxy as own sidebar items when the user is
  entitled (predicate from `Services.tsx` reused).
- Groups user-related pages under a collapsible "User Management" header
  (default child: Staff Directory).
- Groups operational admin pages under a collapsible "Admin" header.
- Removes Account from the sidebar (it stays in the user-menu dropdown).
- Deletes the now-empty Services page.
- Consolidates `/users` and `/admin/users` to one canonical route.

Server side: no changes. This is a client-only cleanup sprint.

## Success Criteria

- `npm run test:client` passes with the new sidebar structure asserted in
  `tests/client/AppLayout.test.tsx`.
- `npm run test:server` baseline unchanged (~1623/1624).
- Manual smoke: student, staff, and admin roles all see correct sidebar items;
  navigating into `/admin/*` does not change the sidebar; User Management
  group expands and lands on Staff Directory; Claude Code and LLM Proxy
  appear only when entitled; OAuth Clients visible to all auth users.

## Scope

### In Scope

- Replace `APP_NAV` / `ADMIN_WORKFLOW_NAV` / `ADMIN_NAV` with unified
  `SIDEBAR_NAV` supporting collapsible groups.
- Remove `isAdminSection` branch and "Back to App" link.
- Remove Account from sidebar nav (keep in user-menu).
- Remove Services from sidebar nav.
- Add Claude Code sidebar item (entitlement-gated on claude ExternalAccount).
- Add LLM Proxy sidebar item (entitlement-gated on `llmProxyEnabled`).
- New page `client/src/pages/ClaudeCode.tsx` at `/claude-code`.
- New page `client/src/pages/LlmProxy.tsx` at `/llm-proxy`.
- Restore Workspace temp-password block on Account.tsx (extracted from
  Services.tsx before deletion).
- Delete `client/src/pages/Services.tsx` and its test.
- User Management collapsible group with default child Staff Directory.
- Admin collapsible group containing all `/admin/*` ops pages.
- Consolidate `/users` (UsersPanel) and `/admin/users` (AdminUsersPanel)
  to one canonical route; redirect the other.
- Rewrite `tests/client/AppLayout.test.tsx` for new structure.
- New tests: `ClaudeCode.test.tsx`, `LlmProxy.test.tsx`.
- Manual smoke ticket.

### Out of Scope

- New permissions / role concepts (reuse existing helpers).
- Server-side route or service changes.
- Visual / theme changes beyond layout requirements.
- Scope-ceiling enforcement on OAuth client registrations (deferred TODO).

## Test Strategy

- Client tests are the primary automated gate (`npm run test:client`).
- `AppLayout.test.tsx` is substantially rewritten to assert the new single-nav
  structure, the no-morph behaviour, and the click-group behaviour.
- New page tests for `ClaudeCode.tsx` and `LlmProxy.tsx` cover entitlement
  gating and content rendering.
- Server tests are run as a no-regression baseline only.
- A final manual smoke ticket covers role walkthroughs.

## Architecture Notes

See `architecture-update.md` in this sprint directory for the full structural
description of the new `SIDEBAR_NAV` design, module changes, and dependency
graph.

## GitHub Issues

(none)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Strip morph and restructure AppLayout nav | — | 1 |
| 002 | New pages: ClaudeCode.tsx and LlmProxy.tsx | 001 | 2 |
| 003 | Restore Workspace temp-password block on Account | 001 | 2 |
| 004 | Delete Services page and route | 002, 003 | 3 |
| 005 | Consolidate /users and /admin/users | 001 | 2 |
| 006 | Sidebar tests | 001, 002, 003, 004, 005 | 4 |
| 007 | Manual smoke test | 001, 002, 003, 004, 005, 006 | 5 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
