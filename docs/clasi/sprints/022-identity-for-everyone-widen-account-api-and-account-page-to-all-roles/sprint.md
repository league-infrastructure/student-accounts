---
id: "022"
title: "Identity for everyone - widen account API and Account page to all roles"
status: planning
branch: sprint/022-identity-for-everyone-widen-account-api-and-account-page-to-all-roles
use-cases:
  - SUC-022-001
  - SUC-022-002
  - SUC-022-003
  - SUC-022-004
todo:
  - backlog-unshipped-follow-ups-from-sprints-020-and-021.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 022: Identity for Everyone — Widen Account API and Account Page to All Roles

## Goals

Make the Account page's identity sections (Profile, Logins with Add-Login
buttons, UsernamePassword) available to staff and admin users, not just
students. Add a regression test for the AppLayout hook-order fix shipped in
sprint 021.

## Problem

Sprint 020 built the Account page as an identity-only surface with three
Add-Login buttons (Google, GitHub, Pike 13). However, the server endpoint
`GET /api/account` was left gated to `requireRole('student')`, and the client
wrapped the identity sections in `{isStudent && data && (...)}`. Staff and
admin users received a 403 from the API and saw only the HelpSection on the
Account page — no profile, no logins, no Add buttons.

Additionally, sprint 021 fixed a hook-order bug in AppLayout (moving
`useQuery` above a conditional early return), but the fix was never covered
by a test because existing tests mock `useAuth` to return `loading: false`
immediately and never traverse the failing path.

## Solution

1. **Server:** Remove `requireRole('student')` from `GET /api/account` and
   `DELETE /api/account/logins/:id`. The handler already computes cohort,
   workspaceTempPassword, and llmProxyEnabled from DB queries; these return
   null/false/empty naturally for non-students. No new logic required.

2. **Client:** Drop the `enabled: isStudent` query guard and the
   `{isStudent && data && (...)}` render gate from `Account.tsx`. Render
   ProfileSection, LoginsSection (with all three Add buttons), and
   UsernamePasswordSection for any authenticated user who receives account
   data. WorkspaceSection retains its existing internal nullcheck and needs
   no role gate.

3. **Tests:** Flip the existing "admin/staff do not see identity sections"
   test assertions to confirm those sections ARE rendered. Add an AppLayout
   loading-to-resolved hook-order regression test.

## Success Criteria

- `GET /api/account` returns 200 for staff and admin (not 403).
- Staff and admin users see ProfileSection, LoginsSection (all three Add
  buttons), and UsernamePasswordSection on the Account page.
- WorkspaceSection is visible for users who have a workspace ExternalAccount
  or a League-format primary email; hidden otherwise (unchanged behavior).
- Student experience is unchanged.
- AppLayout hook-order regression test passes and covers the
  `loading: true` → `loading: false` transition.
- Server and client test suites remain at or above baseline.

## Scope

### In Scope

- Remove `requireRole('student')` from `GET /api/account` and
  `DELETE /api/account/logins/:id` in `server/src/routes/account.ts`.
- Drop `isStudent` guards from `Account.tsx` query and render tree.
- Update `tests/client/pages/Account.test.tsx` to assert staff/admin
  identity sections render.
- Add AppLayout loading-to-resolved hook-order regression test in
  `tests/client/AppLayout.test.tsx`.
- Manual smoke pass for staff and admin Account page.

### Out of Scope

- Scope ceilings on OAuth client registration (sprint 023, item B).
- Per-user OAuth client caps and admin shared pool (sprint 023, item C).
- Dropping `/admin/oauth-clients` and `/api/admin/oauth-clients` compat
  redirects (sprint 023, item D).
- Visual or theme changes.
- LLM proxy access for non-students (separate feature decision).

## Test Strategy

**Server (integration, real test DB):**
- `GET /api/account` with a staff session returns 200 and valid shape.
- `GET /api/account` with an admin session returns 200 and valid shape.
- `DELETE /api/account/logins/:id` with a staff session and own login returns
  204.

**Client (Vitest + React Testing Library):**
- `Account.test.tsx`: staff and admin render tests assert ProfileSection
  heading, LoginsSection heading, Add Google / Add GitHub / Add Pike 13
  buttons present.
- `AppLayout.test.tsx`: new describe block renders with `loading: true`,
  asserts loading spinner; transitions to `loading: false`, asserts sidebar
  link (e.g. "Account") visible without React errors.

## Architecture Notes

- No Prisma schema changes; no database migration.
- The `['account']` React Query cache key is shared between AppLayout and
  Account.tsx. Widening the query in Account.tsx (dropping `enabled: isStudent`)
  aligns it with AppLayout's existing pattern (`enabled: !loading && !!user`).
- `GET /api/account/llm-proxy` retains its `requireRole('student')` guard —
  that endpoint is student-only and is not in scope.

## TODO Reference

Source backlog: `docs/clasi/todo/backlog-unshipped-follow-ups-from-sprints-020-and-021.md`

- **Item A** (staff/admin Add-Login buttons) — fully consumed by this sprint.
- **Item E test** (AppLayout hook-order regression test) — consumed by this sprint.
- Items B, C, D — deferred to sprint 023.

The TODO file is NOT moved to done: items B, C, D remain pending for
sprint 023.

## GitHub Issues

(None linked.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Server — widen GET /api/account to all authenticated roles | — | 1 |
| 002 | Client — drop isStudent gate; render identity sections for all roles | 001 | 2 |
| 003 | Test — AppLayout loading-to-resolved hook-order regression | — | 1 |
| 004 | Manual smoke — stakeholder verification of staff/admin Account page | 001, 002, 003 | 3 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
