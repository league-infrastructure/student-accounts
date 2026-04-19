---
id: "001"
title: "Extend GoogleAdminDirectoryClient to GoogleWorkspaceAdminClient with write methods and Fake"
status: todo
use-cases: [UC-005, UC-012]
depends-on: []
github-issue: ""
todo: ""
---

# Extend GoogleAdminDirectoryClient to GoogleWorkspaceAdminClient with write methods and Fake

## Description

Sprint 002 delivered `GoogleAdminDirectoryClient` with a single read-only
method `getUserOU`. Sprint 004 needs write operations (createUser, createOU,
suspendUser, deleteUser, listUsersInOU) requiring broader OAuth scopes.

This ticket renames/extends the existing client to `GoogleWorkspaceAdminClient`
and creates the corresponding `FakeGoogleWorkspaceAdminClient` for tests.

The write-enable flag and domain/OU guard are addressed in T002 (which depends
on this ticket). This ticket focuses on the structural extension only: interface
definition, method stubs with SDK integration, credential loading reuse,
scope broadening, and the fake.

## Acceptance Criteria

- [ ] File `server/src/services/auth/google-admin-directory.client.ts` is
      renamed to `server/src/services/google-workspace/google-workspace-admin.client.ts`
      (or equivalent path). The old path is removed or re-exports the new one.
- [ ] The `GoogleWorkspaceAdminClient` interface includes all methods:
      `getUserOU`, `createUser`, `createOU`, `suspendUser`, `deleteUser`,
      `listUsersInOU`.
- [ ] The `GoogleAdminDirectoryClient` class is renamed to
      `GoogleWorkspaceAdminClient` and implements the new interface.
- [ ] Credential loading (`GOOGLE_SERVICE_ACCOUNT_FILE` / `GOOGLE_SERVICE_ACCOUNT_JSON`
      resolution, bare-filename-to-`config/files/` logic) is preserved unchanged
      from Sprint 002.
- [ ] The auth client constructed for write methods uses the combined scope list:
      `admin.directory.user.readonly`, `admin.directory.user`,
      `admin.directory.orgunit`. (For `getUserOU` specifically, the existing scope
      is sufficient, but the auth client is shared so broader scopes are used
      for all calls.)
- [ ] `createUser(params: CreateUserParams): Promise<CreatedUser>` is implemented:
      calls `admin.users.insert` with `sendNotificationEmail` from params;
      returns `{ id, primaryEmail }` from the API response.
- [ ] `createOU(name: string): Promise<CreatedOU>` is implemented: calls
      `admin.orgunits.insert` to create a child OU. The full `ouPath` is returned.
      (GOOGLE_STUDENT_OU_ROOT is used here — read from env; client reads config
      vars it needs directly. The guard against invalid root is in T002.)
- [ ] `suspendUser(email: string): Promise<void>` is implemented: calls
      `admin.users.update` with `suspended: true`.
- [ ] `deleteUser(email: string): Promise<void>` is implemented: calls
      `admin.users.delete`.
- [ ] `listUsersInOU(ouPath: string): Promise<WorkspaceUser[]>` is implemented:
      calls `admin.users.list` with `query: "orgUnitPath='<ouPath>'"` and handles
      pagination to return all users.
- [ ] `FakeGoogleWorkspaceAdminClient` is created at
      `tests/server/helpers/fake-google-workspace-admin.client.ts`. It:
      - Implements the `GoogleWorkspaceAdminClient` interface.
      - Records each call in a `calls` object (`calls.createUser: Array<CreateUserParams>`, etc.).
      - Supports configurable return values per method via a `configure` or similar API.
      - Supports configurable thrown errors per method for testing failure paths.
      - Default return for `createUser`: `{ id: 'fake-gws-user-id', primaryEmail: params.primaryEmail }`.
      - Default return for `createOU`: `{ ouPath: '/Students/' + name }`.
      - Default for all other methods: resolves void.
- [ ] All existing Sprint 002 tests that referenced `FakeAdminDirectoryClient`
      are updated to use `FakeGoogleWorkspaceAdminClient`. The `getUserOU` behavior
      is the same; only the import path and class name change.
- [ ] `npm test` passes (all existing tests continue to pass).

## Implementation Plan

### Approach

Extend in place. Rename the file and class; add write methods. This avoids
maintaining two clients for the same Google API connection.

### Files to Create

- `server/src/services/google-workspace/google-workspace-admin.client.ts` — renamed/moved client
- `server/src/services/google-workspace/index.ts` — barrel export
- `tests/server/helpers/fake-google-workspace-admin.client.ts` — fake

### Files to Modify

- `server/src/services/auth/passport.config.ts` — update import path
- `server/src/services/auth/sign-in.handler.ts` — update import path and type reference
- `tests/server/helpers/passport-test-setup.ts` — replace `FakeAdminDirectoryClient` with
  `FakeGoogleWorkspaceAdminClient`
- All Sprint 002 test files that instantiate `FakeAdminDirectoryClient` — update
  to `FakeGoogleWorkspaceAdminClient`
- `config/dev/secrets.env.example` and `config/prod/secrets.env.example` — add
  `GOOGLE_STUDENT_OU_ROOT`, `GOOGLE_STUDENT_DOMAIN`, `GOOGLE_WORKSPACE_WRITE_ENABLED`
  (even though the guard is in T002, the env vars should be documented here)

### Files to Delete

- `server/src/services/auth/google-admin-directory.client.ts` — replaced by new location

### Testing Plan

No new integration tests in this ticket. The fake itself should have unit tests
covering: call recording works, configurable return values work, configurable
throws work. These are fast unit tests (no DB, no network).

Existing Sprint 002 integration tests (staff OU detection) must still pass after
the import path update — this is the primary regression check.

### Documentation Updates

Update `config/dev/secrets.env.example` and `config/prod/secrets.env.example`
with the three new env vars. Add inline comments explaining each.
