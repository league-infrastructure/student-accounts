---
status: final
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 012 Use Cases

## SUC-012-001: Admin creates an app-level Group
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: Admin is signed in. A group name that is non-blank
  and not already in use is available.
- **Main Flow**:
  1. Admin opens `/groups`.
  2. Admin types a group name in the Create form and (optionally) a
     description.
  3. Admin submits the form.
  4. Server creates a `Group` row and emits a `create_group` audit event.
  5. Admin sees the new group in the list with a member count of 0.
- **Postconditions**: A new `Group` exists. An audit event with
  `action='create_group'` is recorded.
- **Acceptance Criteria**:
  - [ ] `POST /api/admin/groups` with `{ name }` returns 201 with
        `{ id, name, description, createdAt, memberCount: 0 }`.
  - [ ] Duplicate name returns 409.
  - [ ] Blank name returns 422.
  - [ ] Audit event `create_group` is emitted with the admin as actor
        and the group id as target.
  - [ ] `/groups` page renders the new group with "0 members".

## SUC-012-002: Admin adds a member to a group by searching
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: A group exists. At least one user exists whose
  `display_name`, `primary_email`, or any of whose `Login.provider_email`
  / `Login.provider_username` matches the admin's query string.
- **Main Flow**:
  1. Admin opens `/groups/:id`.
  2. Admin types a query into the member search box.
  3. The client calls `GET /api/admin/groups/:id/user-search?q=...` and
     renders matching users not already in the group.
  4. Admin clicks a search result.
  5. Server creates a `UserGroup` join row and emits a
     `add_group_member` audit event.
  6. Admin sees the user in the member table; the search result is no
     longer shown.
- **Postconditions**: The target user is a member of the group. An
  audit event records the addition.
- **Acceptance Criteria**:
  - [ ] `GET /admin/groups/:id/user-search?q=...` matches users on
        `display_name`, `primary_email`, `Login.provider_email`, or
        `Login.provider_username` (case-insensitive substring).
  - [ ] Results exclude users already in the group and inactive users.
  - [ ] `POST /admin/groups/:id/members` with `{ userId }` returns 201
        and emits an `add_group_member` audit event.
  - [ ] Adding a user who is already a member returns 409.

## SUC-012-003: Admin removes a member from a group
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: A group exists with at least one member.
- **Main Flow**:
  1. Admin opens `/groups/:id`.
  2. Admin clicks "Remove" on a member row.
  3. Admin confirms.
  4. Server deletes the `UserGroup` row and emits a
     `remove_group_member` audit event.
  5. The member row disappears from the table.
- **Postconditions**: The target user is no longer a member of the
  group. An audit event records the removal.
- **Acceptance Criteria**:
  - [ ] `DELETE /admin/groups/:id/members/:userId` returns 204.
  - [ ] Removing a non-member returns 404.
  - [ ] Audit event `remove_group_member` is emitted.

## SUC-012-004: Admin manages group membership from the user detail page
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: A user exists. At least one group exists.
- **Main Flow**:
  1. Admin opens `/users/:id`.
  2. The new "Groups" section lists the user's current memberships.
  3. Admin picks a group from a dropdown and clicks "Add".
  4. Server creates a `UserGroup` row and emits `add_group_member`.
  5. Admin clicks "Remove" on an existing membership.
  6. Server deletes the row and emits `remove_group_member`.
- **Postconditions**: The user's group memberships reflect the changes.
- **Acceptance Criteria**:
  - [ ] `GET /admin/users/:id/groups` returns the user's groups with
        `{ id, name }`.
  - [ ] Add + remove reuse the endpoints from SUC-012-002/003.
  - [ ] The Groups section on `/users/:id` updates optimistically.

## SUC-012-005: Admin deletes a group
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: A group exists.
- **Main Flow**:
  1. Admin clicks "Delete" on the group detail page.
  2. Admin confirms.
  3. Server deletes all `UserGroup` rows for the group in a single
     transaction, deletes the group, and emits a `delete_group` audit
     event.
- **Postconditions**: The group no longer exists. All prior membership
  rows for the group are removed.
- **Acceptance Criteria**:
  - [ ] `DELETE /admin/groups/:id` returns 204.
  - [ ] Group membership rows are removed in the same transaction as
        the group delete.
  - [ ] Audit event `delete_group` is emitted with the group id.

## SUC-012-006: Admin bulk-creates League accounts for a group
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: A group exists with at least one active student
  member whose student cohort has a `google_ou_path`.
- **Main Flow**:
  1. Admin opens `/groups/:id`.
  2. Admin clicks "Create League Accounts".
  3. Admin confirms.
  4. Server iterates eligible members, calls
     `workspaceProvisioning.provision` per user inside its own
     transaction, and returns succeeded/failed.
  5. The UI shows a banner with succeeded count and failure reasons.
- **Postconditions**: Eligible members have new `workspace`
  ExternalAccounts. Ineligible members are reported with reasons.
- **Acceptance Criteria**:
  - [ ] `POST /admin/groups/:id/bulk-provision` with
        `{ accountType: 'workspace' }` returns 200/207 with
        `{ succeeded, failed }`.
  - [ ] Failure entries include `{ userId, userName, error }`.
  - [ ] No partial successes are rolled back on individual failures.

## SUC-012-007: Admin bulk-invites Claude seats for a group
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: A group exists with at least one active member
  without an `active`/`pending` Claude ExternalAccount.
- **Main Flow**:
  1. Admin opens `/groups/:id`.
  2. Admin clicks "Invite to Claude".
  3. Admin confirms.
  4. Server iterates eligible members, calls
     `claudeProvisioning.provision` per user, and returns results.
- **Postconditions**: Each eligible member gets a pending claude
  `ExternalAccount`.
- **Acceptance Criteria**:
  - [ ] `POST /admin/groups/:id/bulk-provision` with
        `{ accountType: 'claude' }` returns 200/207.
  - [ ] Failure entries match the shape used by the cohort bulk path.

## SUC-012-008: Admin bulk-suspends/removes all accounts for a group
Parent: UC-ADMIN

- **Actor**: Admin
- **Preconditions**: A group exists with at least one member that has
  at least one live `workspace` or `claude` ExternalAccount.
- **Main Flow**:
  1. Admin opens `/groups/:id`.
  2. Admin clicks "Suspend All" or "Delete All".
  3. Admin confirms.
  4. Server iterates every live `workspace`/`claude` ExternalAccount
     for every active member and applies `suspend` / `remove` per
     account in its own transaction.
- **Postconditions**: All eligible accounts are suspended/removed.
  Failures are reported with `type` (`workspace` | `claude`) so the
  banner can render "name (claude): reason".
- **Acceptance Criteria**:
  - [ ] `POST /admin/groups/:id/bulk-suspend-all` and
        `/bulk-remove-all` return 200/207 with `{ succeeded, failed }`.
  - [ ] Failure entries carry a `type` field.
  - [ ] Behaviour matches the existing cohort `*AllInCohort` methods
        (shared helper preferred).
