---
id: "016"
title: "Universal Account Dashboard + App Tiles"
status: planning
branch: sprint/016-universal-account-dashboard-app-tiles
use-cases: [SUC-016-001, SUC-016-002, SUC-016-003]
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 016: Universal Account Dashboard + App Tiles

## Goals

Every authenticated user — student, staff, or admin — lands on `/account`
after login. The page renders role-appropriate "app tiles" that link to
sub-applications the user is entitled to. User Management and the LLM Proxy
become tiles rather than default landing pages. No new identity logic or schema
changes are introduced.

## Problem

Today the post-login routing is fragmented: admins go to `/`, staff go to
`/staff/directory`, and students go to `/account`. There is no universal
landing page and no way for users to see what sub-applications they can access.
`Account.tsx` is student-only; staff and admin have no personal account screen.

## Solution

1. Add `GET /api/account/apps` — a server-side endpoint that returns a
   role-appropriate tile list for the current user. Tile entitlements are
   computed from `user.role` and LLM proxy token status. No schema changes.
2. Change `postLoginRedirect()` in `server/src/routes/auth.ts` to always
   return `/account` regardless of role. Remove the staff → `/staff/directory`
   and admin → `/` special cases.
3. Refactor `client/src/pages/Account.tsx`: remove the admin `<Navigate to="/">`
   redirect; load `/api/account/apps` via React Query; render an Apps zone below
   the existing Profile/Identity content.
4. Add a new `AppTile` component in `client/src/components/`.
5. Update `docs/clasi/design/specification.md` to drop the "no OAuth stored"
   line and add use cases UC-019–UC-021.

## Success Criteria

- All three roles (student, staff, admin) land on `/account` immediately after
  OAuth login.
- `GET /api/account/apps` returns tiles appropriate to the caller's role and
  entitlements; returns 401 for unauthenticated callers.
- An admin sees at least the User Management tile; a student with an LLM proxy
  token sees the LLM Proxy tile; a student without a token does not.
- Clicking a tile navigates to the corresponding sub-app.
- No schema migration is required.
- Existing student-facing Account page content (Profile, Sign-in Methods,
  Services, Claude Code, LLM Proxy card) is unchanged and still visible to
  students.

## Scope

### In Scope

- New `GET /api/account/apps` route + service logic
- `postLoginRedirect()` simplified to always return `/account`
- `Account.tsx` extended to render an Apps zone for all roles
- New `AppTile` component
- Removal of the admin `<Navigate to="/" />` redirect in `Account.tsx`
- `spec.md` update: drop "no OAuth stored", add UC-019/020/021
- Integration tests for `/api/account/apps` covering role-based tile logic

### Out of Scope

- Schema changes of any kind
- New authentication methods
- OAuth provider work (Sprints 017–019)
- Changing the visual design of existing Account page sections
- Staff directory page changes (it becomes a tile but its own page is untouched)

## Test Strategy

Integration tests against the real SQLite test DB (per project testing rules —
no DB mocks):
- `GET /api/account/apps` for student without LLM token → no LLM tile
- `GET /api/account/apps` for student with active LLM token → LLM tile present
- `GET /api/account/apps` for staff → directory tile present
- `GET /api/account/apps` for admin → user-management tile present
- `GET /api/account/apps` unauthenticated → 401
- Auth callback redirects (Google, GitHub, Pike13) with staff role → `/account`
- Auth callback redirects with admin role → `/account`

## Architecture Notes

- Tile computation is pure logic: role string + boolean LLM grant → tile array.
  No DB query beyond what `requireAuth` already fetches.
- `GET /api/account/apps` uses `requireAuth` middleware. No `requireRole`
  restriction — all authenticated users are allowed.
- `Account.tsx` removes its early `<Navigate to="/" />` admin redirect. All
  roles render the page; the Apps zone handles role-specific tiles.
- Tile data shape: `{ id, title, description, href, icon }` — icon is a string
  key (emoji or icon name; client renders it).

## GitHub Issues

(None linked.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | `/api/account/apps` route + service | — | 1 |
| 002 | Post-login redirect to `/account` for all roles | — | 1 |
| 003 | `AppTile` component + `Account.tsx` refactor | 001 | 2 |
| 004 | Tile entitlement logic per role | 001 | 2 |
| 005 | Spec doc + use case updates (UC-019/020/021) | — | 1 |
| 006 | Manual smoke pass (stakeholder verification) | 001, 002, 003, 004, 005 | 3 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
