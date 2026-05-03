---
id: '026'
title: Groups as permission carriers - OAuth client LLM proxy League account toggles
status: done
branch: sprint/026-groups-as-permission-carriers-oauth-client-llm-proxy-league-account-toggles
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 026: Groups as permission carriers

## Goals

Make the Group entity the primary vehicle for granting feature permissions to users.
Three boolean toggles on a Group (`allowsOauthClient`, `allowsLlmProxy`,
`allowsLeagueAccount`) control which capabilities members receive. Permissions are
additive: a user gets a capability if ANY of their groups grants it.

This replaces the per-user lozenge filters for LLM Proxy and OAuth Client introduced
in Sprint 025 with a group-based policy layer. Existing users/clients are grandfathered.

## Problem

Permissions are currently per-user only (via LlmProxyToken existence and OAuthClient
ownership). There is no way to say "every member of group X may register OAuth clients"
without manual per-user configuration. The lozenge filters in AdminUsersPanel show these
as user properties, but the business model has shifted: the group is the unit of access.

## Solution

1. Add three boolean columns to the `Group` schema (`allowsOauthClient`,
   `allowsLlmProxy`, `allowsLeagueAccount`).
2. Introduce a `userPermissions(userId)` service helper that computes the additive
   union across a user's groups.
3. Extend `OAuthClientService.create` to reject non-admin users unless their group
   permissions grant `oauthClient` (grandfather: existing clients are exempt).
4. Extend `LlmProxyTokenService.grant` to reject grants unless the target user's
   group permissions grant `llmProxy` (grandfather: existing active tokens are exempt).
5. Add `GroupService.setPermission` with provisioning fan-out when
   `leagueAccount` is toggled on.
6. Update `GroupService.addMember` to auto-provision when the group has
   `allowsLeagueAccount`.
7. Strip cohort-derived OU logic from `WorkspaceSyncService.syncStudents`; all new
   Workspace accounts go to `/Students`.
8. Add a PATCH endpoint on groups, wire three permission toggles in GroupDetailPanel.
9. Remove LLM Proxy and OAuth Client lozenges from AdminUsersPanel.

## Success Criteria

- Toggle `allowsLeagueAccount` on → every member without a Workspace account is
  provisioned to `/Students` within seconds.
- Add user to a league-account group → provisioned on add.
- Student NOT in any OAuth-client group → `POST /api/oauth-clients` returns 403.
- Grandfathered student (existing client at sprint start) → can still view/edit client
  despite having no group permission.
- LLM proxy grant for user with no llm-proxy group → 403.
- LLM Proxy and OAuth Client lozenges absent from AdminUsersPanel.

## Scope

### In Scope

- Schema: three boolean columns on Group.
- `userPermissions(userId)` helper in GroupService (or separate module).
- OAuthClientService.create — group permission check (with grandfather bypass).
- LlmProxyTokenService.grant — group permission check.
- GroupService.setPermission + provisioning fan-out.
- GroupService.addMember — auto-provision on add to league-account group.
- WorkspaceSyncService.syncStudents — drop cohort-derived OU paths; all to /Students.
- PATCH /admin/groups/:id — set permission flags.
- GroupDetailPanel three permission toggles.
- AdminUsersPanel — remove LLM Proxy and OAuth Client feature lozenges.
- Server-side tests for all policy changes.
- Client-side tests for toggle UI and lozenge removal.
- Manual smoke ticket.

### Out of Scope

- Migrating existing Cohort↔User assignments into Group memberships.
- Group-level OAuth client cap override (per-user cap from Sprint 023 still applies).
- "Your groups grant …" informational section on the Account page.
- Bulk add/remove members on GroupDetailPanel beyond what already exists.
- Expanded audit-event surfacing on the group page.

## Test Strategy

- Unit tests: `userPermissions` helper (all combinations of empty / single / multi-group,
  role variants).
- Integration tests (Supertest): OAuthClientService.create grandfather rule; LLM proxy
  grant rejection; PATCH /admin/groups/:id permission flags; provisioning fan-out on
  setPermission and addMember.
- Client unit tests (Vitest + RTL): GroupDetailPanel toggle render and PATCH fire;
  AdminUsersPanel absence of LLM Proxy / OAuth Client lozenges.
- Manual smoke (ticket 009): end-to-end verification against dev stack.

## Architecture Notes

- Permissions are computed at call time from the live Group rows — no denormalization.
  Caching is per-request (function argument passed through the call stack), not
  across requests.
- Grandfather rule for OAuthClient: non-admin users who already have at least one
  non-disabled client are exempt from the group-permission check on future creates.
  The check still applies to users with zero existing clients.
  (Rationale: we do not revoke existing work; the new check gates new registrations.)
- Grandfather rule for LlmProxy: the group-permission check applies only to the
  `grant` call. Existing active tokens are not revoked when a group's
  `allowsLlmProxy` is toggled off.
- Workspace provisioning via `setPermission(leagueAccount, true)` and `addMember`
  both reuse the existing `WorkspaceSyncService` provisioning primitives,
  targeting `/Students` OU.

## GitHub Issues

(None yet — tickets will reference issues if opened.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Schema: add permission columns to Group | — | 1 |
| 002 | Server: userPermissions helper | 001 | 2 |
| 003 | Server: OAuthClientService create — group permission gate | 002 | 3 |
| 004 | Server: LLM proxy grant — group permission gate | 002 | 3 |
| 005 | Server: GroupService.setPermission + addMember provisioning; PATCH endpoint | 002 | 3 |
| 006 | Server: WorkspaceSyncService — drop cohort OU paths; all to /Students | 001 | 3 |
| 007 | Client: GroupDetailPanel permission toggles | 005 | 4 |
| 008 | Client: Remove LLM Proxy + OAuth Client lozenges from AdminUsersPanel | — | 4 |
| 009 | Manual smoke | 003, 004, 005, 006, 007, 008 | 5 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
