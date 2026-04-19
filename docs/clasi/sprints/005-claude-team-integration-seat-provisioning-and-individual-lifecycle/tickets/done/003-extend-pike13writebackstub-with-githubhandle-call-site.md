---
id: '003'
title: Extend Pike13WritebackStub with githubHandle call site
status: done
use-cases:
- SUC-002
depends-on: []
---

# Extend Pike13WritebackStub with githubHandle call site

## Description

Add a second no-op export to `server/src/services/pike13-writeback.stub.ts`:
`githubHandle(userId: number, username: string): Promise<void>`. This export
is the call site for UC-008 / SUC-002 — when an admin adds a GitHub Login on a
user's behalf, the system should write the GitHub username back to the user's
Pike13 record. Sprint 006 will replace this stub with a real implementation.

The existing `leagueEmail` export is unchanged.

## Acceptance Criteria

- [x] `pike13-writeback.stub.ts` exports `githubHandle(userId, username)` as an async no-op.
- [x] The function logs at INFO level: "pike13-writeback: githubHandle deferred to Sprint 006 — no-op call site".
- [x] TypeScript compiles cleanly with the new export.
- [x] Existing tests continue to pass.

## Implementation Plan

### Approach

Add a single async function export to the existing stub file. No new files
required.

### Files to modify

- `server/src/services/pike13-writeback.stub.ts` — add `githubHandle` export.

### Testing plan

- No new tests needed for a no-op. Verify TypeScript compiles (tsc --noEmit).
- The caller (admin login-add route, T010) will have an integration test that
  asserts the stub was invoked.

### Documentation updates

None.
