---
status: pending
---

# Groups become the permission/feature unit

Stakeholder direction captured 2026-05-02 after sprint 025 close-or-merge.
The Group entity becomes the primary way to grant features and
permissions to users. Toggle a permission on a group → every member
gets that capability. This replaces the per-user lozenge filters
(LLM Proxy, OAuth Client) introduced in sprint 025.

## Stakeholder decisions (locked)

- **Multi-group rule:** ADDITIVE. A user gets a permission if ANY of
  their groups grants it.
- **Migration:** GRANDFATHER. Existing `llmProxyEnabled` users keep
  their tokens; existing OAuth clients stay registered. Group
  permissions only control future provisioning / future denials.
- **League account provisioning:** IMMEDIATE. Toggling the
  league-account permission on creates Workspace accounts for every
  member right away; adding a user to such a group provisions them
  on add. Workspace accounts go to the `/Students` OU. Cohorts are
  no longer used.
- **OAuth client cap interaction:** group permission grants the
  capability; the per-user cap from sprint 023 still applies (students
  capped at 1 unless their group is also given a higher cap). For now,
  no group-level cap override — this means a student with the OAuth-client
  permission can still only have 1 client; staff/admin remain unlimited.
  (If we want a group to grant unlimited, that's a follow-up.)

## Permissions to model

Three group-level toggles:

1. **OAuth Client** — members may register OAuth clients. Without
   this permission, the OAuth Clients UI/API still lets them VIEW
   any existing clients they own (grandfathered) but `POST` to
   create returns 403.
2. **LLM Proxy** — members may have an active LLM proxy token.
   Toggling on does not auto-grant a token (admin still grants),
   but toggling off blocks future token grants. Existing tokens
   are grandfathered (per the migration rule).
3. **League Account** — members get a `@jointheleague.org`
   Workspace account provisioned in the `/Students` OU.
   Toggling on triggers an immediate provisioning sweep over the
   group; adding a user to such a group provisions on add.
   Toggling off does NOT delete existing accounts (grandfather).

## What changes (overview)

### Schema (Prisma)

Add to the `Group` model:

```prisma
allowsOauthClient    Boolean @default(false)
allowsLlmProxy       Boolean @default(false)
allowsLeagueAccount  Boolean @default(false)
```

No data migration; defaults to false on existing groups.

### Server

- New helper / service method `userPermissions(userId)` returning
  `{ oauthClient: boolean, llmProxy: boolean, leagueAccount: boolean }`
  derived from the union of the user's group permissions. Cache for the
  duration of a request.
- `OAuthClientService.create` — augment scope/cap policy to also
  reject when the actor is non-admin AND no group grants
  `allowsOauthClient` (and is not already grandfathered with at
  least one existing client).
- LLM proxy token grant path (admin grants tokens to a user) —
  reject when no group grants `allowsLlmProxy` for the target user.
- New `GroupService.setPermission(groupId, perm, value, actor)` — set
  a permission flag and, if `perm === 'leagueAccount' && value === true`,
  fan out a provisioning request for every member who doesn't already
  have a Workspace account.
- `GroupService.addMember(groupId, userId, actor)` — if the group has
  `allowsLeagueAccount === true` and the user has no Workspace account,
  trigger provisioning.
- `WorkspaceSyncService` provisioning paths — write all newly-created
  Workspace accounts into the `/Students` OU (drop any cohort/OU
  derivation logic; cohorts are gone).

### Client

- **Group detail page** (`client/src/pages/admin/GroupDetailPanel.tsx`,
  if it exists; otherwise as part of the Groups page) — add three
  toggles for the permissions. Toggling fires `PATCH /api/admin/groups/:id`
  with the new flag. UI explains "Toggling this on grants the
  capability to every member."
- **AdminUsersPanel feature lozenges** — REMOVE the LLM Proxy and
  OAuth Client lozenges. Keep Google, Pike 13, GitHub (those are
  external account presence, still useful as filters). The user list
  still shows accumulated capability via the per-row Accounts column
  if helpful, but the lozenge filters specifically for LLM Proxy /
  OAuth Client come out.
- The Account page can show a "Your groups grant: …" list as
  informational (optional, low priority).

### Sync

- All new Workspace account provisioning targets `/Students`. The
  existing cohort-derived OU path logic is removed from the
  provisioning path. (Sprint 025 ticket 004 already redirected
  cohort writes to Group writes; this finishes the cohort drop on
  the provisioning side.)

## Out of scope

- Migrating existing Cohort↔User assignments into Group memberships
  (still deferred — separate sprint).
- Group-level OAuth client cap override (defer; per-user cap still
  applies for now).
- UI for "Your groups grant …" on the Account page (optional).
- Bulk add/remove members on the group detail page beyond what
  already exists.
- Audit-event surfacing on the group page beyond what already exists.

## Suggested ticket shape

1. Schema: add three boolean columns to Group; Prisma db push.
2. Server: `userPermissions(userId)` helper + tests.
3. Server: enforce in OAuthClientService.create (with grandfather
   bypass) + tests.
4. Server: enforce on LLM proxy token grant + tests.
5. Server: GroupService.setPermission + addMember provisioning
   triggers; new PATCH endpoint on groups.
6. Server: WorkspaceSyncService provisioning targets /Students; drop
   cohort-derived OU paths; tests.
7. Client: GroupDetailPanel toggles wired to PATCH; tests.
8. Client: drop LLM Proxy + OAuth Client lozenges from AdminUsersPanel;
   tests.
9. Manual smoke (stakeholder verification).

## Verification

- Toggle league-account ON for a group → every member's Workspace
  account appears in /Students within seconds.
- Add a user to a league-account group → they get a Workspace
  account provisioned.
- Student NOT in any OAuth-client group → POST /api/oauth-clients
  returns 403 with message naming the missing permission.
- Student grandfathered (existing client at sprint start) → can
  still see/edit that client even without the group permission.
- LLM proxy token grant for a user with no llm-proxy group → 403.
