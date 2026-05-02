---
id: '020'
title: Account Redesign Sidebar Apps and OAuth Clients Democratization
status: done
branch: sprint/020-account-redesign-sidebar-apps-and-oauth-clients-democratization
use-cases:
- SUC-020-001
- SUC-020-002
- SUC-020-003
- SUC-020-004
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 020: Account Redesign Sidebar Apps and OAuth Clients Democratization

## Goals

Redesign the post-Sprint-016 Account page from a tile-grid launchpad into a
strict identity-management page. Move sub-applications (User Management,
Staff Directory, Cohorts, Groups, Services, OAuth Clients) into the sidebar.
Promote OAuth Clients out of `/admin` so every authenticated user can
register their own clients.

## Problem

Sprint 016 made `/account` a universal landing page with a tile grid that
links to sub-apps. The stakeholder reviewed it and finds the layout
unwanted: it conflates identity with launchpad and external-service status.
Separately, OAuth Clients management is admin-only; the long-term plan is
for every user to integrate third-party tools, so this gating is the wrong
default.

## Solution

1. **Strip Account.tsx to identity-only.** Keep ProfileSection (display
   name, email, role/cohort badges) and LoginsSection (linked OAuth
   identities + add/remove). Add a UsernamePasswordSection for users with
   passphrase credentials. Add a third Add-Login button (Pike 13). Drop
   the AppsZone, ServicesSection, ClaudeCodeSection, and
   AccountLlmProxyCard from this page.
2. **Delete the AppTile API + UI.** Remove
   `server/src/routes/account-apps.ts`,
   `server/src/services/app-tiles.service.ts`, and
   `client/src/components/AppTile.tsx` plus all tests and the `/api/account/apps`
   mount.
3. **Consolidate Services UI into a new `/services` sidebar page.** Moves
   the external-account status table, Claude Code instructions, and LLM
   proxy management from Account into one new page. Conditional rendering
   per role + entitlements; friendly empty state.
4. **Populate the sidebar** with role-gated app menu items: Account,
   Services, OAuth Clients (always); Staff Directory + User Management
   (staff/admin); Cohorts + Groups (admin). Reuse existing
   `hasAdminAccess()`; add `hasStaffAccess()` helper.
5. **Move OAuth Clients out of `/admin`.** Server: rename router to
   `server/src/routes/oauth-clients.ts`, mount at `/api/oauth-clients`
   behind `requireAuth` only. Service layer enforces ownership: non-admins
   see only their own (`created_by`); admins see all. Provide a
   compatibility redirect from `/api/admin/oauth-clients/*` →
   `/api/oauth-clients/*`. Client: move page to
   `client/src/pages/OAuthClients.tsx` at route `/oauth-clients`. Replace
   the free-text scope input with a checkbox group (`profile`,
   `users:read`).
6. **New `PATCH /api/account/credentials` endpoint** for username/password
   editing of passphrase-credentialed users.

## Success Criteria

- `/account` shows ONLY: profile info, linked logins, three Add-Login
  buttons (Google, GitHub, Pike 13), and a username/password section for
  users who have credentials.
- No tile grid anywhere; AppTile component is deleted.
- Sidebar lists role-appropriate sub-app links for every user.
- Every authenticated user can navigate to `/oauth-clients` and manage
  THEIR OWN clients. Admins still see all clients.
- A non-admin attempt to mutate another user's client returns 403.
- Scope selection on the OAuth Clients form uses checkboxes for the
  fixed set of scopes (`profile`, `users:read`).
- Pike 13 link button on Account works end-to-end.
- Server suite returns to baseline (~1620 passing, modulo SQLite ordering flake).
- Client suite holds baseline (~203 passing + 35 pre-existing failures).
- New tests: ownership filtering on OAuth clients, Account / Services /
  sidebar component tests, scope-checkbox behaviour, credentials endpoint.

## Scope

### In Scope

- Server route + service changes for OAuth Clients democratization with
  ownership filtering and admin override.
- Compatibility redirect at `/api/admin/oauth-clients/*`.
- New `PATCH /api/account/credentials` endpoint and supporting service
  changes.
- Account.tsx strip + UsernamePasswordSection + Pike 13 button.
- New Services page consolidating Workspace status, Claude Code, LLM proxy.
- Sidebar items + role gating.
- OAuthClients page move (admin → main app) + scope-checkbox UI.
- Deletions: AppTile, app-tiles service + route, related tests.
- Tests for all of the above.

### Out of Scope

- Scope ceilings on non-admin OAuth client registration (TODO follow-up).
- Rate limits on OAuth client creation.
- Removing the `/admin/oauth-clients` and `/api/admin/oauth-clients`
  redirects (defer to a follow-up release).
- Visual / theme changes beyond what the new pages require.

## Test Strategy

Integration tests against the real test DB (no Prisma mocks).

**Server:**
- `GET /api/oauth-clients` — student sees only own clients; staff same;
  admin sees all.
- `PATCH/POST/DELETE /api/oauth-clients/:id` — owner OR admin succeeds;
  others get 403.
- Compatibility redirect: `GET /api/admin/oauth-clients` → 308 redirect.
- `PATCH /api/account/credentials`:
  - Sets username (uniqueness enforced).
  - Changes password (current password verified via existing scrypt path).
  - Returns 400 on bad input, 401 unauth, 409 username taken.
- Removed routes and services (`/api/account/apps`, app-tiles) absent.

**Client:**
- Account.tsx: shows three Add buttons; UsernamePasswordSection visible
  iff user has username/password; AppsZone gone.
- Services.tsx: renders the consolidated zones; empty state when nothing
  applies.
- AppLayout sidebar: correct items per role; OAuth Clients always visible.
- OAuthClients page: scope checkboxes render and submit; non-admin sees
  only own clients in the list.

## Architecture Notes

- Schema: NO migration. `OAuthClient.created_by` already exists from
  Sprint 018.
- Service registry: oauth-client service gains an `actorRole` parameter on
  list/find/update/disable/rotate. Admin override is a single bool check.
- The Pike 13 link mode is already wired (Sprint 015); this sprint just
  adds the third Add-Login button on the Account page and ensures the
  link flow lands back on `/account`.
- `hasStaffAccess(role)` joins existing role helpers in
  `client/src/lib/roles.ts` (returns true for `staff` or `admin`).
- The compatibility redirect uses `308 Permanent Redirect` (preserves the
  HTTP method, unlike 301).

## GitHub Issues

(None linked.)

## Definition of Ready

- [x] Sprint planning documents complete.
- [x] Architecture review passed.
- [x] Stakeholder approved.

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Delete AppTile API and component | — | 1 |
| 002 | Move OAuth Clients router with ownership filtering and compat redirect | — | 1 |
| 003 | PATCH /api/account/credentials endpoint | — | 1 |
| 004 | Account.tsx strip with UsernamePasswordSection and Pike13 button | 003 | 2 |
| 005 | New Services page consolidating Workspace Claude LLM zones | 001 | 2 |
| 006 | OAuthClients page move out of admin and scope checkbox UI | 002 | 2 |
| 007 | Sidebar role-gated app menu items in AppLayout | 001, 005, 006 | 3 |
| 008 | Manual smoke pass stakeholder verification sweep | 001-007 | 4 |
