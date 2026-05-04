---
id: '027'
title: Per-user permissions via group member grid - revert group-level model
status: done
branch: sprint/027-per-user-permissions-via-group-member-grid-revert-group-level-model
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
todo:
- per-user-permissions-via-group-grid.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 027: Per-user permissions via group member grid — revert group-level model

## Goals

Reverse the group-level permission model shipped in sprint 026 and replace it
with a per-user model. The three boolean permission flags
(`allows_oauth_client`, `allows_llm_proxy`, `allows_league_account`) move from
the `Group` row to the `User` row. Administrators set them by checking
individual checkboxes in the group's member grid rather than toggling a group-wide
switch.

## Problem

Sprint 026 placed permission flags on `Group` so that every member of a group
would inherit those capabilities. Stakeholder direction after ship: the unit of
permission is the individual user, not the group. A group is a convenient
viewport for finding users and toggling their flags, not a permission carrier.
The group-wide toggle does not provide the granularity needed to permit some
members and not others.

## Solution

Move the three booleans from `Group` to `User`. Rewrite
`GroupService.userPermissions(userId)` to read directly from the `User` row
instead of aggregating across group memberships. Expose a new
`PATCH /api/admin/users/:id/permissions` endpoint so that each checkbox in
the group member grid can independently set one user's flags. Drop the
`GroupDetailPanel` Permissions section and drop `GroupService.setPermission`
entirely. Add three checkbox columns to the group member grid. Toggling the
League Account checkbox on triggers immediate single-user provisioning via a
refactored helper.

## Success Criteria

- `User` schema has the three boolean columns; `Group` schema does not.
- `GET /api/admin/users/:id/permissions` (or the member-list endpoint) returns
  per-user flag values that reflect the `User` row.
- `PATCH /api/admin/users/:id/permissions` updates the flags and immediately
  provisions a Workspace account when `allows_league_account` transitions to
  `true`.
- GroupDetailPanel member grid shows three checkbox columns; checking/unchecking
  PATCHes the user.
- GroupDetailPanel Permissions section is gone.
- `GroupService.setPermission` is deleted.
- OAuth client creation and LLM proxy grant gates read from the User row
  (via rewritten `userPermissions`).
- All existing tests pass; new tests cover the permissions endpoint and the
  per-user provisioning path.

## Scope

### In Scope

- Schema migration: add three booleans to `User`, drop three from `Group`.
- Rewrite `GroupService.userPermissions(userId)` to read from `User` row.
- New `PATCH /api/admin/users/:id/permissions` route.
- Single-user provisioning helper extracted from `_provisionMembersWithoutWorkspace`.
- `GroupDetailPanel`: remove Permissions section, add three checkbox columns.
- Remove any standalone per-user "Grant LLM proxy" / "Create League account"
  buttons found in `UserDetailPanel` or elsewhere (scope-check the codebase).
- Drop `GroupService.setPermission` and the `PATCH /admin/groups/:id`
  permission-flag endpoint behaviour (the PATCH route itself can stay or
  be gutted — tickets decide).
- `GET /admin/groups/:id` response: remove `allowsOauthClient`,
  `allowsLlmProxy`, `allowsLeagueAccount` fields.
- Update `listMembers` (and its API response) to include per-user permission
  flags so the grid can render them.

### Out of Scope

- Per-user permission UI on `UserDetailPanel` (follow-up if desired).
- Bulk column toggle (header checkbox to set all members).
- Audit history beyond what exists.
- Any changes to the bulk-provision or bulk-revoke toolbar buttons.

## Test Strategy

- Unit tests: `GroupService.userPermissions` now reads from the User row — test
  with users that have flags true/false.
- Route tests: `PATCH /api/admin/users/:id/permissions` — valid flag update,
  unknown fields ignored, 404 on missing user.
- Route tests: League Account toggle-on triggers provisioning call (mock
  `WorkspaceProvisioningService`).
- Route tests: `GET /admin/groups/:id` no longer returns permission fields.
- Client tests: GroupDetailPanel checkbox columns render and fire PATCH on
  change.
- Smoke test: manual end-to-end via browser.

## Architecture Notes

See `architecture-update.md` for the full design. Key decisions:

- `userPermissions` becomes a trivial single-row read — one DB query, no join.
- The route handler for `PATCH /api/admin/users/:id/permissions` owns the
  provisioning side-effect, keeping `GroupService` free of the provisioning
  dependency for new-permission grants.
- `GroupService.addMember` provisioning logic is preserved but simplified: it
  no longer checks `group.allows_league_account`; instead, it provisions only
  if the user's own `allows_league_account` flag is already true.
  (Alternatively, that path is dropped entirely — see architecture doc.)

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Schema: move permission flags from Group to User | — | 1 |
| 002 | Server: rewrite userPermissions to read from User row | 001 | 2 |
| 003 | Server: PATCH /api/admin/users/:id/permissions endpoint | 001 | 2 |
| 004 | Server: single-user provisioning helper + League Account toggle | 003 | 3 |
| 005 | Server: drop GroupService.setPermission and group PATCH permission fields | 002 | 3 |
| 006 | Client: remove GroupDetailPanel Permissions section | 005 | 4 |
| 007 | Client: add three permission checkbox columns to GroupDetailPanel member grid | 004, 006 | 5 |
| 008 | Manual smoke test | 007 | 6 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
