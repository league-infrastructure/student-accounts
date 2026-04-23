---
id: "001"
title: "Data model — Group and UserGroup entities, repository"
status: todo
use-cases: ["SUC-012-001", "SUC-012-002", "SUC-012-003", "SUC-012-004", "SUC-012-005"]
depends-on: []
github-issue: ""
todo: "app-level-groups-for-bulk-provisioning.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Data model — Group and UserGroup entities, repository

## Description

Add the two Prisma models that underpin this sprint: `Group` (the app-
level group entity) and `UserGroup` (the many-to-many join with
`User`). Implement the `GroupRepository` with typed CRUD and the two
query helpers used by later tickets (member count aggregation, user
search scoped to a group).

Use `prisma db push` against the dev SQLite database per
`.claude/rules/setup.md` — dev DB is disposable; no migration file is
required.

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma` defines a `Group` model with
      `id`, `name` (`@unique`), `description` (nullable), `created_at`,
      `updated_at`, and `users: UserGroup[]` relation.
- [ ] `server/prisma/schema.prisma` defines a `UserGroup` model with
      `user_id`, `group_id`, `created_at`, `@@id([user_id, group_id])`,
      `@@index([group_id])`, `@@index([user_id])`, FK to `User` and
      `Group` both with `onDelete: Cascade`.
- [ ] `User` model gains `groups: UserGroup[]` back-relation.
- [ ] `npx prisma generate` succeeds and the generated client types
      include `Group` and `UserGroup`.
- [ ] `cd server && ./prisma/sqlite-push.sh` (or equivalent
      `prisma db push` invocation) applies the schema to the dev DB.
- [ ] `server/src/services/repositories/group.repository.ts` exists
      and exports a `GroupRepository` class with static methods:
      - `create(db, { name, description? })`
      - `findById(db, id)` / `findByName(db, name)`
      - `findAllWithMemberCount(db)` — returns each group with a
        `memberCount: number` field.
      - `update(db, id, { name?, description? })`
      - `delete(db, id)` (raw — caller is expected to wipe
        memberships first inside the same transaction).
      - `listMembers(db, groupId)` — returns users ordered by
        `display_name` with `external_accounts` preloaded.
      - `searchUsersNotInGroup(db, groupId, q, limit)` — matches on
        `User.display_name`, `User.primary_email`,
        `Login.provider_email`, `Login.provider_username`
        (case-insensitive); excludes `is_active=false` and members
        already in the group; default `limit` 25.
      - `listGroupsForUser(db, userId)` — returns the `Group[]` the
        user belongs to, ordered by name.
      - `addMember(db, groupId, userId)` /
        `removeMember(db, groupId, userId)`.
      - `deleteMembershipsForGroup(db, groupId)`.
- [ ] Repository is exported from
      `server/src/services/repositories/index.ts`.
- [ ] Unit-level tests live in
      `tests/server/repositories/group.repository.test.ts` and cover
      create, findById, findByName, findAllWithMemberCount (including
      zero-member group), addMember (unique violation), removeMember
      (not-found), listMembers ordering, searchUsersNotInGroup across
      every match field, listGroupsForUser, and
      deleteMembershipsForGroup.

## Testing

- **Existing tests to run**: `npm run test:server`. Pre-existing
  Sprint-010 client drift (documented in sprint brief) is acceptable.
- **New tests to write**: see last acceptance criterion.
- **Verification command**: `npm run test:server && npm run test:client`.
