---
id: '023'
title: OAuth clients hardening - scope ceilings per-user caps and drop admin compat
  redirects
status: done
branch: sprint/023-oauth-clients-hardening-scope-ceilings-per-user-caps-and-drop-admin-compat-redirects
use-cases:
- SUC-023-001
- SUC-023-002
- SUC-023-003
- SUC-023-004
- SUC-023-005
todo:
- backlog-unshipped-follow-ups-from-sprints-020-and-021.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 023: OAuth Clients Hardening — Scope Ceilings, Per-User Caps, and Drop Admin Compat Redirects

## Goals

1. Enforce scope ceilings by role: students may register clients with only the
   `profile` scope; staff and admin may use any scope.
2. Enforce per-user client caps: students are limited to one OAuth client total;
   staff and admin have no cap.
3. Confirm and test the admin shared-pool invariant: any admin can view, edit,
   rotate, or delete any other admin's client.
4. Remove the temporary `/api/admin/oauth-clients` server compat router and the
   `/admin/oauth-clients` client-side `<Navigate>` redirect, both shipped in
   sprint 020 as temporary shims.
5. Surface all policy restrictions in the client UI so users understand why
   certain actions are unavailable before they hit a server error.

## Problem

Sprint 020 democratized OAuth client registration for all authenticated users
but explicitly deferred two security measures: scope ceilings and per-user
caps. As a result, a student can currently register a client requesting
`users:read` and read the entire user directory. The temporary compat redirects
shipped at sprint 020 are also still live, adding dead weight and confusion to
the routing layer.

## Solution

Introduce a `ScopePolicy` module in the server service layer that encodes the
allowed-scopes set for each role. The `create` and `update` paths in
`OAuthClientService` call `ScopePolicy.assertAllowed(actorRole, requestedScopes)`
before writing, throwing a typed `ForbiddenError` on violation. A parallel
`ClientCapPolicy` module encodes the per-user cap and is checked in the `create`
path by counting existing clients owned by the actor.

On the client, `OAuthClients.tsx` reads the actor's role from `AuthContext` and
passes a filtered scope list to `ScopeCheckboxGroup`; it also suppresses the
"New OAuth Client" button (replacing it with an explanatory message) when the
actor's client count equals their cap.

The compat router is deleted from `server/src/routes/oauth-clients.ts` and its
mount removed from `server/src/app.ts`. The `<Navigate>` route is removed from
`client/src/App.tsx`.

## Success Criteria

- A student attempting to create a client with `users:read` receives a 403.
- A student with one existing client receives a 403 on a second create attempt.
- A staff user can create a client with `users:read` and create more than one.
- An admin can create clients without limit and with any scope.
- Admin A can edit, rotate, and delete Admin B's client (shared-pool).
- `GET /api/admin/oauth-clients` returns 404 (compat router removed).
- `GET /admin/oauth-clients` in the browser resolves to NotFound (Navigate gone).
- The OAuth Clients page hides scope checkboxes the user's role cannot use.
- The page hides the create form when the user is at their cap, with a message.
- All TODO comments about scope ceilings are removed from the codebase.

## Scope

### In Scope

- Server: `ScopePolicy` — allowed-scopes table keyed by role.
- Server: `ClientCapPolicy` — max-clients-per-user table keyed by role.
- Server: Enforcement in `OAuthClientService.create` (cap check + scope check).
- Server: Enforcement in `OAuthClientService.update` (scope check on update).
- Server: Audit event for cap-rejected create attempt.
- Server: Admin shared-pool invariant tests (admin-A-mutates-admin-B scenarios).
- Server: Delete `oauthClientsCompatRouter` from `oauth-clients.ts` and its mount in `app.ts`.
- Client: Scope checkbox filtering — show only the actor's permitted scopes.
- Client: Create form / button suppression when at cap, with explanation message.
- Client: Remove `<Navigate to="/oauth-clients" replace />` from `App.tsx`.
- Client: Remove all TODO comments about scope ceilings.
- Tests: All role × scope combinations (create + update).
- Tests: Student cap (zero → one → blocked at two).
- Tests: Staff/admin: no cap, any scope.
- Tests: Admin shared-pool (admin A edits/rotates/disables admin B's client).
- Tests: Compat router 404 after deletion.
- Smoke: Manual stakeholder verification.

### Out of Scope

- Scope ceilings for the update-only form fields (redirect URIs, name,
  description) — those carry no privilege risk.
- Staff cap differentiation from admin (staff have no cap per stakeholder).
- Pagination or sorting of the OAuth clients list.
- Any changes to the OAuth authorization flow or token issuance.
- New scopes beyond `profile` and `users:read`.
- Item A (Add-Login buttons for staff/admin) — completed in sprint 022.
- Item E (sprint 021 polish punch-list) — already shipped.

## Test Strategy

- **Server integration tests** (`tests/server/routes/oauth-clients.test.ts`,
  `tests/server/services/oauth/oauth-client.service.test.ts`): cover all role ×
  scope combinations for create and update; cap enforcement; admin shared-pool;
  compat router removal (expect 404).
- **Client unit tests** (`tests/client/pages/OAuthClients.test.tsx`): verify
  scope checkboxes are filtered by role; verify create form is hidden at cap
  with the right message; snapshot or assertion-based.
- **Manual smoke** (ticket 006): stakeholder verifies the end-to-end flows in
  the browser.

## Architecture Notes

See `architecture-update.md` in this sprint directory for the full design.

Key decisions:
- Policy is encoded in two small pure modules (`ScopePolicy`, `ClientCapPolicy`)
  rather than inline conditionals in the service — single-change point for future
  policy evolution.
- Server enforcement is authoritative; client enforcement is UX only (does not
  replace server checks).
- Cap check uses a `count` query scoped to `created_by = actorUserId` —
  admin clients are excluded from the count when the actor is admin (admins have
  no cap, so no count is needed).

## GitHub Issues

(None filed for this sprint.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Server — scope-ceiling policy and enforcement | — | 1 |
| 002 | Server — per-user cap enforcement | — | 1 |
| 003 | Server + Client — drop compat redirects | — | 1 |
| 004 | Server — admin shared-pool invariant tests | 001, 002 | 2 |
| 005 | Client — OAuth Clients page UX for caps and scope ceilings | 001, 002 | 2 |
| 006 | Manual smoke — stakeholder verification | 003, 004, 005 | 3 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
