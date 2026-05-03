---
sprint: "027"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 027

## SUC-001: Schema reflects per-user permission flags

**Actor**: Database / Prisma schema
**Goal**: Persist the three boolean capability flags on the `User` entity, not on `Group`.

**Main Flow**:
1. The `User` model gains `allows_oauth_client`, `allows_llm_proxy`,
   `allows_league_account` columns (all Boolean, default false).
2. The `Group` model has those three columns removed.
3. Existing User rows default to false (no migration needed — sprint 026 never
   flipped any group flags in production).
4. `prisma db push` applies the change to the development database.

**Out of scope**: Data migration (groups had no flags set).

---

## SUC-002: Admin reads a user's effective permissions

**Actor**: Server-side permission gate
**Goal**: Any service that needs to know whether a user is allowed to create an
OAuth client, receive an LLM proxy token, or get a Workspace account reads a
single User row — not a join over group memberships.

**Main Flow**:
1. A route handler calls `GroupService.userPermissions(userId)`.
2. The service looks up the User row and returns
   `{ oauthClient, llmProxy, leagueAccount }` from `User.allows_*` columns.
3. The OAuth client creation gate and the LLM proxy grant gate consume this result
   (unchanged from sprint 026 — only the data source changes).

**Postcondition**: Permission checks are O(1) single-row reads with no group join.

---

## SUC-003: Admin sets per-user permission flags via API

**Actor**: Admin user
**Goal**: An admin can set any combination of the three permission flags on an
individual user through a REST endpoint.

**Main Flow**:
1. Admin sends `PATCH /api/admin/users/:id/permissions` with a JSON body
   containing one or more of `{ allows_oauth_client?, allows_llm_proxy?,
   allows_league_account? }` (all optional booleans).
2. Server validates body fields; returns 400 on invalid types, 404 on missing user.
3. Server updates the User row with the provided fields.
4. An audit event (`user_permission_changed`) is recorded.
5. Server returns the updated user permission state.
6. If `allows_league_account` transitions to `true`, see SUC-004.

**Alternate Flow**: Body contains no recognized fields — no-op, 200 with current
state returned.

---

## SUC-004: League Account checkbox triggers immediate single-user provisioning

**Actor**: Admin user
**Goal**: When an admin checks the League Account box for a member in the group
grid (setting `allows_league_account = true`), the system immediately provisions
a Google Workspace account in `/Students` for that user if they do not already
have one.

**Main Flow**:
1. Admin checks League Account checkbox for a member in `GroupDetailPanel`.
2. Client sends `PATCH /api/admin/users/:id/permissions` with
   `{ allows_league_account: true }`.
3. Server persists the flag and then calls the single-user provisioning helper.
4. Helper checks whether the user already has an active/pending workspace
   `ExternalAccount`; if not, calls `WorkspaceProvisioningService.provision`.
5. Provisioning is fail-soft — errors are logged but do not roll back the flag update.
6. Response returns success; client shows the updated checkbox state.

**Grandfather rule**: Toggling `allows_league_account` to `false` does NOT
delete or suspend existing Workspace accounts.

---

## SUC-005: GroupDetailPanel shows per-member permission checkboxes

**Actor**: Admin user
**Goal**: An admin can see and toggle per-member permission flags directly in the
group member grid.

**Main Flow**:
1. Admin opens a group's detail page.
2. The member grid has three new columns: OAuth Client, LLM Proxy, League Account.
3. Each cell shows a checkbox whose state reflects the corresponding User flag.
4. Clicking a checkbox sends `PATCH /api/admin/users/:id/permissions` with the
   changed flag.
5. On success the checkbox reflects the new state; on failure an error banner appears.

**Grid data source**: `GET /admin/groups/:id/members` response is extended to
include `allowsOauthClient`, `allowsLlmProxy`, `allowsLeagueAccount` per member.

---

## SUC-006: GroupDetailPanel Permissions section is removed

**Actor**: Admin user
**Goal**: The group-level "Permissions" toggle section (added in sprint 026) is
deleted. Admins can no longer toggle group-wide flags because those flags no
longer exist on the Group model.

**Main Flow**:
1. Admin opens a group's detail page.
2. No "Permissions" section is visible; there are no group-wide toggle rows.
3. `GET /admin/groups/:id` response no longer includes `allowsOauthClient`,
   `allowsLlmProxy`, `allowsLeagueAccount`.

**Postcondition**: `GroupService.setPermission` is deleted; `PATCH /admin/groups/:id`
no longer processes permission flag fields (the endpoint can be removed or kept
for future use with non-permission fields).

---

## SUC-007: Manual smoke test confirms end-to-end correctness

**Actor**: QA / stakeholder
**Goal**: A manual walkthrough confirms the feature works correctly in the dev
environment.

**Verification steps**:
1. Open a group with several members. Confirm three new checkbox columns in the
   member grid.
2. Check "LLM Proxy" for one member. Confirm the User row updates. Confirm
   `GroupService.userPermissions` returns `llmProxy: true` for that user.
3. Check "League Account" for a member without a Workspace account. Confirm
   provisioning fires and the member gains a workspace `ExternalAccount`.
4. Uncheck "League Account". Confirm no account is deleted.
5. Confirm the Permissions section is absent from the group header.
6. Confirm OAuth client creation gate respects the per-user flag.
