---
id: '002'
title: Write-enable flag and domain/OU guard in GoogleWorkspaceAdminClient
status: in-progress
use-cases:
- UC-005
- UC-012
depends-on:
- '001'
github-issue: ''
todo: ''
---

# Write-enable flag and domain/OU guard in GoogleWorkspaceAdminClient

## Description

The spec (§6.1) and the architecture require two hard safety mechanisms inside
`GoogleWorkspaceAdminClient`:

1. **Write-enable flag** (`GOOGLE_WORKSPACE_WRITE_ENABLED`): any write method
   (`createUser`, `createOU`, `suspendUser`, `deleteUser`) must check this env
   var and throw `WorkspaceWriteDisabledError` if it is not exactly `"1"`.
   Prevents accidental writes in development or misconfigured environments.

2. **Domain/OU guard**: `createUser` must verify the `primaryEmail` domain
   equals `GOOGLE_STUDENT_DOMAIN` and the `orgUnitPath` starts with
   `GOOGLE_STUDENT_OU_ROOT`. If either check fails, throw
   `WorkspaceDomainGuardError`. This is a defence-in-depth check — it fires
   even if the caller has already validated the values.

Both mechanisms are added to the client class built in T001. This ticket
also defines the typed error classes.

## Acceptance Criteria

- [x] `WorkspaceWriteDisabledError` class defined and exported from the
      client module (or a shared errors module). Extends `Error` with a
      descriptive message.
- [x] `WorkspaceDomainGuardError` class defined and exported. Extends `Error`.
      Constructor accepts `reason: string` that explains which guard triggered.
- [x] `WorkspaceApiError` class defined and exported. Wraps Admin SDK HTTP
      errors. Includes `statusCode: number` and `sdkMessage: string`.
- [x] All write methods (`createUser`, `createOU`, `suspendUser`, `deleteUser`)
      check `GOOGLE_WORKSPACE_WRITE_ENABLED === '1'` as their first step.
      If false, they throw `WorkspaceWriteDisabledError` and log at ERROR level.
- [x] `createUser` checks `primaryEmail` ends with `@${GOOGLE_STUDENT_DOMAIN}`.
      If not, throws `WorkspaceDomainGuardError` before any API call.
- [x] `createUser` checks `orgUnitPath` starts with `GOOGLE_STUDENT_OU_ROOT`.
      If not, throws `WorkspaceDomainGuardError` before any API call.
- [x] `createOU` checks `GOOGLE_WORKSPACE_WRITE_ENABLED` (write gate only —
      no domain check needed for OU creation; the OU path is derived
      internally from `GOOGLE_STUDENT_OU_ROOT`).
- [x] `listUsersInOU` is NOT gated by the write-enable flag (it is read-only).
- [x] `getUserOU` is NOT gated by the write-enable flag (read-only, Sprint 002).
- [x] Unit tests cover:
      - Write method called without flag → `WorkspaceWriteDisabledError` thrown.
      - `createUser` with `@jointheleague.org` email → `WorkspaceDomainGuardError`.
      - `createUser` with OU outside student root → `WorkspaceDomainGuardError`.
      - `createUser` with correct domain and OU, flag set → no guard error (proceeds
        to SDK call, which can be mocked to return success).
      - `listUsersInOU` works without the write-enable flag.
- [x] `FakeGoogleWorkspaceAdminClient` does NOT enforce these guards (the fake
      is for testing callers, not for testing the guard itself — guard tests
      test the real client with mocked SDK).
- [x] `npm test` passes.

## Implementation Plan

### Approach

Add guard logic at the top of each write method. Read env vars via
`process.env` (consistent with Sprint 002 client). Define typed error classes
in `server/src/errors.ts` (the existing shared errors module from Sprint 001)
or in a new `server/src/services/google-workspace/errors.ts` — prefer the
latter to keep Google-specific errors co-located with the client.

### Files to Modify

- `server/src/services/google-workspace/google-workspace-admin.client.ts` —
  add guard logic to write methods.

### Files to Create

- `server/src/services/google-workspace/errors.ts` — `WorkspaceDomainGuardError`,
  `WorkspaceWriteDisabledError`, `WorkspaceApiError`.
- `tests/server/services/google-workspace/google-workspace-admin.client.test.ts` —
  unit tests for the guards.

### Testing Plan

Unit tests only (no DB, no real network). Mock the googleapis `admin` object
to return configurable responses. Test each guard condition independently.
The write-enable flag test should confirm the flag check runs before any
other logic (e.g., no SDK object is constructed when the flag is absent).

### Documentation Updates

None beyond what T001 added to `secrets.env.example`.
