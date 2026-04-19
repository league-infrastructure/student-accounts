---
id: "005"
title: "GoogleWorkspaceAdminClient: add listOUs method"
status: done
use-cases: [SUC-001]
depends-on: []
github-issue: ""
todo: ""
---

# GoogleWorkspaceAdminClient: add listOUs method

## Description

Extend `GoogleWorkspaceAdminClient` with a `listOUs(parentPath)` read method
that wraps `directory.orgunits.list` filtered to the given parent OU path.
This is a read-only method required by `WorkspaceSyncService.syncCohorts`
(SUC-001). The write-enable flag does NOT apply to this method.

Also extend `FakeGoogleWorkspaceAdminClient` (in the test helpers directory)
with a corresponding fake `listOUs` implementation.

## Acceptance Criteria

- [x] `GoogleWorkspaceAdminClient` interface gains:
  ```typescript
  listOUs(parentPath: string): Promise<WorkspaceOU[]>
  ```
  where `WorkspaceOU = { name: string; orgUnitPath: string }`.
- [x] `GoogleWorkspaceAdminClientImpl` implements `listOUs` using
  `directory.orgunits.list` with `customerId='my_customer'` and filtering to
  direct children of `parentPath`.
- [x] The method is read-only; `GOOGLE_WORKSPACE_WRITE_ENABLED` is not checked.
- [x] `WorkspaceApiError` is thrown on Admin SDK HTTP error.
- [x] `FakeGoogleWorkspaceAdminClient` gains `listOUs(parentPath)` that returns
  a configurable seeded list of `WorkspaceOU` objects.
- [x] `tests/server/helpers/fake-google-workspace-admin.client.ts` updated.
- [x] Existing tests continue to pass (no regressions to existing methods).
- [x] Unit test: `listOUs` returns child OUs for a given parent path;
  empty result for a path with no children.

## Implementation Plan

### Approach

1. Add `WorkspaceOU` type to the interface definitions in
   `google-workspace-admin.client.ts`.
2. Add `listOUs` to the `GoogleWorkspaceAdminClient` interface.
3. Implement `listOUs` in `GoogleWorkspaceAdminClientImpl` using the
   `googleapis` Admin SDK `orgunits.list` call. Filter by `orgUnitPath` to
   return only direct children (or at one level deep) under `parentPath`.
4. Update `FakeGoogleWorkspaceAdminClient` with a `listOUs` method and a
   configurable seed map `{ [parentPath: string]: WorkspaceOU[] }`.
5. Write unit tests for the fake (the real client is smoke-tested manually).

### Files to Modify

- `server/src/services/google-workspace/google-workspace-admin.client.ts` —
  add interface entry and implementation
- `server/src/services/google-workspace/index.ts` — re-export `WorkspaceOU`
- `tests/server/helpers/fake-google-workspace-admin.client.ts` — add `listOUs`

### Files to Create

- `tests/server/services/workspace/list-ous.test.ts` (unit test for fake
  behavior and interface contract)

### Testing Plan

- Unit tests using the fake client: correct OUs returned for a seeded parent
  path, empty result for unknown path.
- The real client is exercised only by a manual smoke test with live credentials.

### Documentation Updates

- None. Architecture update already documents the interface extension.
