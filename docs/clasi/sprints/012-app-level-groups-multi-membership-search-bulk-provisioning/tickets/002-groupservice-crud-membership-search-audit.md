---
id: "002"
title: "GroupService — CRUD, membership, search, audit"
status: todo
use-cases: ["SUC-012-001", "SUC-012-002", "SUC-012-003", "SUC-012-004", "SUC-012-005"]
depends-on: ["001"]
github-issue: ""
todo: ""
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GroupService — CRUD, membership, search, audit

## Description

Implement the domain service for `Group`. Wraps `GroupRepository` with
validation, audit-event recording, and transactional semantics. Mirrors
the style of `CohortService`.

## Acceptance Criteria

- [ ] `server/src/services/group.service.ts` exports `GroupService`.
- [ ] Constructor: `new GroupService(prisma, audit: AuditService)`.
- [ ] `create({ name, description? }, actorId)`:
      - Trims name; throws `ValidationError` on blank.
      - Throws `ConflictError` if name already exists.
      - Opens a `prisma.$transaction` that creates the group and
        emits a `create_group` audit event.
      - Returns the created row.
- [ ] `update(id, { name?, description? }, actorId)`:
      - Throws `NotFoundError` if missing.
      - If `name` changes, validates non-blank + unique.
      - Writes changes and emits `update_group` with
        `details = { old, new }` in one transaction.
- [ ] `delete(id, actorId)`:
      - Throws `NotFoundError` if missing.
      - Inside one `prisma.$transaction`:
        1. Counts current memberships.
        2. Calls `GroupRepository.deleteMembershipsForGroup`.
        3. Deletes the group.
        4. Emits `delete_group` with
           `details = { name, memberCount }`.
- [ ] `findById(id)` — throws `NotFoundError` if missing.
- [ ] `findAll()` — returns `{ id, name, description, memberCount,
      createdAt }[]` ordered by name.
- [ ] `listMembers(groupId)` — returns `{ group, users }` shape
      aligned with `/admin/cohorts/:id/members` (users with
      `externalAccounts` projected the same way).
- [ ] `addMember(groupId, userId, actorId)`:
      - Throws `NotFoundError` if group or user is missing.
      - Throws `ConflictError` if the pair already exists.
      - Inside one transaction: creates the `UserGroup` row and
        emits `add_group_member` with
        `target_user_id = userId`,
        `target_entity_type = 'Group'`,
        `target_entity_id = group.id`,
        `details = { group_name }`.
- [ ] `removeMember(groupId, userId, actorId)`:
      - Throws `NotFoundError` if no such membership.
      - Inside one transaction: deletes the row and emits
        `remove_group_member` with the same projection.
- [ ] `searchUsersNotInGroup(groupId, q, limit?)`:
      - Returns `{ id, displayName, email, matchedOn }[]`.
      - `matchedOn` is the field that matched first
        (`'display_name'` | `'primary_email'` |
        `'provider_email'` | `'provider_username'`).
      - Trims `q`; returns `[]` on empty/short query (<2 chars).
- [ ] `listGroupsForUser(userId)` returns `{ id, name }[]` for the
      groups this user belongs to, ordered by name.
- [ ] Registered on `ServiceRegistry` as `groups: GroupService`.
- [ ] Request type augmentation (`server/src/contracts`)
      includes `groups` on `req.services` if the typing file lists
      service properties explicitly.
- [ ] Unit tests in `tests/server/services/group.service.test.ts`
      cover every public method and every error branch.

## Testing

- **Existing tests to run**: `npm run test:server`.
- **New tests to write**: `group.service.test.ts` covering all
  public methods + error branches + audit-event emission.
- **Verification command**: `npm run test:server`.
