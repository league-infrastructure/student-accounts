---
status: pending
---

# Per-user permissions via group member grid (reverses sprint 026 group-level model)

Stakeholder direction captured 2026-05-02 after sprint 026 shipped
group-level permission toggles. Reversing course: permissions become
per-user, with the group's member grid as the UI affordance for
setting them.

## What changes

**Drop from sprint 026:**
- The Permissions section on `GroupDetailPanel` (the three toggles
  for `allows_oauth_client`, `allows_llm_proxy`, `allows_league_account`).
- Per-user "Grant LLM proxy" / "Create League account" buttons
  wherever they live (search the codebase — UserDetailPanel? per-row
  in AdminUsersPanel? GroupDetailPanel members table?).
- The additive group-permission semantics in `userPermissions(userId)`.

**Add:**
- Three boolean columns on `User`: `allows_oauth_client`,
  `allows_llm_proxy`, `allows_league_account`. (Move from `Group` →
  `User`.) Defaults to false.
- The group's member grid (`GroupDetailPanel`'s table of users in
  the group) gains three new columns: OAuth Client, LLM Proxy,
  League Account. Each cell renders a checkbox bound to the
  corresponding User flag.
- Click checkbox → PATCH the user, set the flag true. Uncheck →
  PATCH false.
- League Account checkbox → on toggle ON, immediately provision
  Workspace account in `/Students` (same as before). Toggle OFF
  does NOT delete (grandfather, same rule as before).
- LLM Proxy and OAuth Client checkboxes are pure permission flags;
  toggling them doesn't grant tokens / create clients automatically.
  The existing gates (sprint 026/003 OAuth, 026/004 LLM proxy)
  switch from reading `userPermissions()` (group-derived) to
  reading the user row directly.

**Server endpoint shape:**
- `PATCH /api/admin/users/:id/permissions` — body `{ allows_oauth_client?, allows_llm_proxy?, allows_league_account? }`.
- Or extend the existing `PUT /api/admin/users/:id` if it makes
  more sense.

**Schema migration:**
- Add three columns to User (nullable bool default false).
- Drop the three columns from Group (they're unused now).
- Existing data: groups had no permissions flipped on (since we
  shipped 026 days ago and it's still under stakeholder review),
  so no data to migrate. If any group HAS a flag set, propagate
  to its current members before dropping the columns.

**UI removals:**
- `GroupDetailPanel` Permissions section deleted.
- Any per-user "Grant LLM proxy" / "Create League account" button
  deleted; the checkbox in the group grid is the only affordance.
- The "Provisioning…" indicator stays — it now fires per-user
  when the league-account checkbox is toggled on.

**Existing users + grandfather:**
- All existing users have these flags false by default. Existing
  OAuth client owners and existing LLM proxy token holders are
  still grandfathered (sprint 026 rules unchanged).

## Sprint shape (suggested)

1. Schema: add three booleans to User; drop from Group; prisma db push.
2. Server: rewrite `userPermissions(userId)` to read from User row directly.
3. Server: PATCH /api/admin/users/:id/permissions endpoint + tests.
4. Server: League Account toggle ON triggers immediate provisioning
   for that one user (refactor sprint 026 fan-out to a single-user
   provisioning helper that's called from both the old group fan-out
   and the new per-user toggle).
5. Client: drop GroupDetailPanel permissions section.
6. Client: drop per-user "Grant LLM proxy" / "Create League account"
   buttons (find and remove).
7. Client: add three checkbox columns to GroupDetailPanel member grid.
8. Manual smoke.

## Out of scope

- UI for setting these flags from anywhere other than the group
  member grid (e.g., individual user detail page). If we want it
  there too, follow-up.
- Auditing / change history beyond what already exists.
- Bulk per-column toggle in the grid (header checkbox to "set all
  members").
