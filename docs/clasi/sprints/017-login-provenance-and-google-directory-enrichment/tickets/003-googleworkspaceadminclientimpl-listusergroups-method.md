---
id: "003"
title: "GoogleWorkspaceAdminClientImpl listUserGroups method"
status: todo
use-cases: [SUC-017-002]
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GoogleWorkspaceAdminClientImpl listUserGroups method

## Description

Extend `GoogleWorkspaceAdminClientImpl` (and the `GoogleWorkspaceAdminClient`
interface) with a method to list the Google Workspace groups a user belongs
to. This will be consumed by the directory-enrichment step at sign-in.

**File:** `server/src/services/google-workspace/google-workspace-admin.client.ts`

Add to the `GoogleWorkspaceAdminClient` interface:

```ts
listUserGroups(email: string): Promise<UserGroup[]>;
```

where `UserGroup = { id: string; name: string; email: string }`.

Implement on `GoogleWorkspaceAdminClientImpl` using the Admin SDK Directory
API: `admin.groups.list({ userKey: email })`. Reuse the existing
`getAdminClient()` (or whatever the existing pattern is — match how
`getUserOU` is implemented). Handle pagination if needed (groups.list returns
up to 200 by default; iterate `pageToken` until exhausted, but cap at 1000
for safety).

If the call fails, throw a `StaffOULookupError` (or a sibling error class
named more generically — e.g., `StaffDirectoryLookupError`) so callers can
distinguish from successes. Don't silently swallow — the consumer in
ticket 004 will fail-soft at its layer.

Also expose the same on the `FakeGoogleWorkspaceAdminClient` test helper
(`tests/server/helpers/fake-google-workspace-admin.client.ts`):
- `configure('listUserGroups', groups)` to inject a fixed return.
- `configure('listUserGroups', new Error('...'))` to throw.

## Acceptance Criteria

- [ ] Interface `GoogleWorkspaceAdminClient` declares `listUserGroups(email)`.
- [ ] `GoogleWorkspaceAdminClientImpl.listUserGroups` calls the Admin SDK and returns the array.
- [ ] Pagination handled (or commented why it's safe to skip — typical staff users have <200 groups).
- [ ] Error path throws a typed error (sibling of `StaffOULookupError`).
- [ ] `FakeGoogleWorkspaceAdminClient` supports `configure('listUserGroups', …)` returning value or throwing.
- [ ] Unit tests for the fake; integration test only via consumer in ticket 004.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/services/google-workspace/google-workspace-admin.client.test.ts` (if exists, extend; else create) — exercise the fake's listUserGroups paths.
- **Verification command**: `npm run test:server`
