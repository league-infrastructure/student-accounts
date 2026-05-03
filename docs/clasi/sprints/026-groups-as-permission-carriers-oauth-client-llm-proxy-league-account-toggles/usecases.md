---
status: draft
sprint: "026"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 026 Use Cases

## SUC-001: Add permission columns to Group schema

- **Actor**: System (Prisma migration / db push)
- **Preconditions**: Group model exists in schema.prisma without permission columns.
- **Main Flow**:
  1. Developer adds `allowsOauthClient Boolean @default(false)`,
     `allowsLlmProxy Boolean @default(false)`, and
     `allowsLeagueAccount Boolean @default(false)` to the Group model.
  2. Developer runs `prisma db push` (dev) or generates a migration (prod).
  3. All existing Group rows receive default value `false` for all three columns.
- **Postconditions**:
  - The Group table has three new boolean columns.
  - No existing Group rows have any permission enabled.
  - No data migration is needed.
- **Acceptance Criteria**:
  - [ ] `Group.allowsOauthClient`, `Group.allowsLlmProxy`, and `Group.allowsLeagueAccount` exist in the generated Prisma client.
  - [ ] `prisma db push` completes without errors on an existing dev database.
  - [ ] Existing Group rows default to `false` for all three columns.

---

## SUC-002: Compute additive user permissions from group membership

- **Actor**: Server (service layer)
- **Preconditions**: A user belongs to zero or more groups; some groups may have
  permission flags set.
- **Main Flow**:
  1. Caller invokes `GroupService.userPermissions(userId)`.
  2. Service fetches all groups the user belongs to via their UserGroup rows.
  3. Service computes the union: `oauthClient = any group.allowsOauthClient`,
     `llmProxy = any group.allowsLlmProxy`,
     `leagueAccount = any group.allowsLeagueAccount`.
  4. Returns `{ oauthClient: boolean, llmProxy: boolean, leagueAccount: boolean }`.
- **Postconditions**: Caller has a permission object reflecting the additive union
  across all the user's groups.
- **Acceptance Criteria**:
  - [ ] User in zero groups → all three permissions false.
  - [ ] User in one group with `allowsOauthClient=true` → `oauthClient=true`.
  - [ ] User in two groups where only one has `allowsLlmProxy=true` → `llmProxy=true`.
  - [ ] User in two groups where neither has `allowsLeagueAccount=true` → `leagueAccount=false`.
  - [ ] Function is tested in isolation with a unit test suite covering all branches.

---

## SUC-003: OAuth client creation gated by group permission (with grandfather)

- **Actor**: Authenticated non-admin user (student or staff)
- **Preconditions**: `POST /api/oauth-clients` endpoint exists.
  The calling user either has or does not have a group granting `allowsOauthClient`.
- **Main Flow (permitted)**:
  1. User makes a `POST /api/oauth-clients` request.
  2. Server checks `userPermissions(userId).oauthClient`.
  3. Permission is `true` → cap and scope policy checks run as before → client created.
- **Main Flow (denied — no group permission, no existing clients)**:
  1. User makes a `POST /api/oauth-clients` request.
  2. `userPermissions(userId).oauthClient` is `false`.
  3. User has zero existing non-disabled clients (no grandfather).
  4. Server returns 403 with a message identifying the missing permission.
- **Main Flow (grandfathered)**:
  1. User makes a `POST /api/oauth-clients` request.
  2. `userPermissions(userId).oauthClient` is `false`.
  3. User already has at least one non-disabled OAuth client (created before this sprint).
  4. Server allows the create to proceed (grandfather exemption applies).
- **Postconditions**: New OAuth client is created when permitted; 403 returned otherwise.
- **Acceptance Criteria**:
  - [ ] Non-admin user in no OAuth-client group, zero existing clients → 403.
  - [ ] Non-admin user in an OAuth-client group → 201 (existing cap/scope rules apply).
  - [ ] Non-admin user with one existing client but no group permission → 201 (grandfather).
  - [ ] Admin user is never gated by group permissions.
  - [ ] 403 error message identifies `allowsOauthClient` group permission as missing.
  - [ ] Server integration test covers all three paths.

---

## SUC-004: LLM proxy token grant gated by group permission

- **Actor**: Admin granting an LLM proxy token to a target user
- **Preconditions**: `POST /admin/users/:id/llm-proxy-token` endpoint exists.
  The target user either does or does not belong to a group with `allowsLlmProxy`.
- **Main Flow (permitted)**:
  1. Admin POSTs a grant request for a target user.
  2. Server checks `userPermissions(targetUserId).llmProxy`.
  3. Permission is `true` → grant proceeds, token created.
- **Main Flow (denied)**:
  1. Admin POSTs a grant request for a target user.
  2. `userPermissions(targetUserId).llmProxy` is `false`.
  3. Server returns 403 with a message identifying the missing group permission.
- **Postconditions**: Token created when target user's groups permit it; 403 otherwise.
- **Acceptance Criteria**:
  - [ ] Target user in no llm-proxy group → 403 on grant attempt.
  - [ ] Target user in an llm-proxy group → grant succeeds (201).
  - [ ] Existing active tokens are NOT revoked when `allowsLlmProxy` is toggled off on a group.
  - [ ] 403 message identifies `allowsLlmProxy` as the blocking permission.
  - [ ] Server integration test covers both paths (permitted and denied).

---

## SUC-005: Admin sets a group permission toggle; League-account toggle triggers provisioning sweep

- **Actor**: Admin
- **Preconditions**: Admin is on the group detail page. Group exists with members.
- **Main Flow (non-provisioning permission)**:
  1. Admin calls `PATCH /admin/groups/:id` with `{ allowsOauthClient: true }`.
  2. Server updates the Group row.
  3. Returns the updated group object.
- **Main Flow (league-account toggle ON)**:
  1. Admin calls `PATCH /admin/groups/:id` with `{ allowsLeagueAccount: true }`.
  2. Server updates the Group row.
  3. Server fans out provisioning requests for every group member who does not
     already have an active Workspace ExternalAccount, targeting `/Students` OU.
  4. Returns the updated group object; provisioning runs asynchronously or inline.
- **Postconditions**:
  - The Group row reflects the new permission state.
  - For `allowsLeagueAccount=true`: every member without a Workspace account has
    a provisioning request initiated; those accounts land in `/Students`.
- **Acceptance Criteria**:
  - [ ] `PATCH /admin/groups/:id` accepts `allowsOauthClient`, `allowsLlmProxy`,
    `allowsLeagueAccount` boolean fields.
  - [ ] Setting `allowsLeagueAccount=true` triggers provisioning for every unprovisioned member.
  - [ ] Members who already have an active Workspace ExternalAccount are not reprovisioned.
  - [ ] Setting `allowsLeagueAccount=false` does NOT delete existing Workspace accounts.
  - [ ] Setting `allowsOauthClient` or `allowsLlmProxy` does not trigger provisioning.
  - [ ] Server integration tests cover toggle-on and toggle-off for all three flags.

---

## SUC-006: Adding a member to a league-account group triggers auto-provisioning

- **Actor**: Admin (via `POST /admin/groups/:id/members`)
- **Preconditions**: The group has `allowsLeagueAccount=true`. The user being added
  does not yet have an active Workspace ExternalAccount.
- **Main Flow**:
  1. Admin adds a user to the group via the existing `POST /admin/groups/:id/members` endpoint.
  2. `GroupService.addMember` checks if the group has `allowsLeagueAccount`.
  3. If `true` and the user has no active Workspace account, a provisioning request
     is triggered for `/Students` OU.
  4. If the group does not have `allowsLeagueAccount`, no provisioning happens.
- **Postconditions**: The user is a group member. If the group grants league-account,
  the user's Workspace account provisioning has been initiated.
- **Acceptance Criteria**:
  - [ ] Adding a user to a league-account group (user has no Workspace account) → provisioning initiated.
  - [ ] Adding a user to a non-league-account group → no provisioning.
  - [ ] Adding a user who already has an active Workspace account → no duplicate provisioning.
  - [ ] Server integration test covers all three branches.

---

## SUC-007: WorkspaceSyncService provisions new accounts to /Students; cohort OU logic removed

- **Actor**: System (WorkspaceSyncService)
- **Preconditions**: `syncStudents` currently iterates Cohort rows to assign per-cohort
  OU paths when creating User rows (legacy `cohort_id` assignment).
- **Main Flow**:
  1. `syncStudents` runs.
  2. All student users are imported with `cohort_id=null`; no Cohort rows are read
     for OU-path derivation.
  3. Any new Workspace ExternalAccount provisioning targets `/Students` (not a
     cohort-derived sub-OU).
- **Postconditions**: The per-cohort OU iteration loop is removed from `syncStudents`.
  New user rows are created with `cohort_id=null`. Existing cohort rows are not touched.
- **Acceptance Criteria**:
  - [ ] `syncStudents` no longer calls `cohortRepo.findAllWithOUPath`.
  - [ ] All user upserts from `syncStudents` use `cohort_id=null`.
  - [ ] Existing Cohort rows and User.cohort_id values are untouched by this sprint.
  - [ ] Server tests for `syncStudents` pass without per-cohort OU iteration.

---

## SUC-008: GroupDetailPanel displays and updates permission toggles

- **Actor**: Admin (UI)
- **Preconditions**: Admin is viewing a group detail page.
- **Main Flow**:
  1. Page loads; three permission toggle controls render showing current group values.
  2. Admin flips a toggle.
  3. Client fires `PATCH /admin/groups/:id` with the changed flag.
  4. On success, the toggle reflects the new state.
  5. For `allowsLeagueAccount` toggled on, a notification or loading indicator
     conveys that provisioning is running.
- **Postconditions**: Group permission state in the database matches what the admin set.
- **Acceptance Criteria**:
  - [ ] Three toggle controls render in GroupDetailPanel.
  - [ ] Toggling any control fires `PATCH /admin/groups/:id` with the correct flag.
  - [ ] Toggle state reflects server response after successful PATCH.
  - [ ] UI explains "Toggling this on grants the capability to every member."
  - [ ] Client unit test covers render and PATCH fire for all three toggles.

---

## SUC-009 (removed): LLM Proxy and OAuth Client lozenges removed from AdminUsersPanel

- **Actor**: Admin (UI)
- **Preconditions**: AdminUsersPanel currently shows LLM Proxy and OAuth Client
  feature lozenges (added in Sprint 025).
- **Main Flow**:
  1. Admin navigates to `/admin/users`.
  2. Feature lozenge bar renders: `Google | Pike 13 | GitHub` (three lozenges).
  3. LLM Proxy and OAuth Client lozenges are absent.
- **Postconditions**: The AdminUsersPanel feature bar has three lozenges, not five.
  The `llmProxyEnabled` and `oauthClientCount` fields may still exist in the API
  response but are no longer used as filter predicates in the client.
- **Acceptance Criteria**:
  - [ ] AdminUsersPanel feature lozenge bar shows only Google, Pike 13, GitHub.
  - [ ] No LLM Proxy or OAuth Client lozenge renders.
  - [ ] Client unit test asserts the absence of both lozenges.
  - [ ] Existing Google, Pike 13, GitHub lozenges continue to function correctly.
