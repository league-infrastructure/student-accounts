---
id: '006'
title: "Merge-scan stub call site \u2014 no-op module wired at new-user creation"
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '002'
github-issue: ''
todo: ''
---

# T006: Merge-scan stub call site — no-op module wired at new-user creation

## Description

Create `server/src/services/auth/merge-scan.stub.ts` — a named no-op function
that logs "merge-scan deferred to Sprint 007 — no-op call site" and returns.
This module is the call site that Sprint 007 will replace with the real
merge-scan implementation. The stub must be imported and called in
`SignInHandler` immediately after new User creation (already scaffolded as
part of T002, which was written expecting this module to exist).

If T002 was implemented with an inline stub, this ticket extracts it into its
own module at the canonical path. Either way, the end state is the same: a
named module at a stable import path that Sprint 007 replaces.

This ticket also confirms that the merge-scan is not called for staff Users
(since `mergeScan` is called only in the new-User branch, and staff re-signins
skip creation).

## Acceptance Criteria

- [x] `server/src/services/auth/merge-scan.stub.ts` exists with an exported
      `async function mergeScan(user: User): Promise<void>` that logs the
      Sprint 007 deferral message and returns.
- [x] `SignInHandler` imports `mergeScan` from `./merge-scan.stub` and calls
      it immediately after new User creation (before returning the User).
- [x] `mergeScan` is not called when an existing User is found (returning-user
      path).
- [x] The log message includes the `userId` for traceability.
- [x] A unit test confirms `mergeScan` is called for new users and not for
      returning users.
- [x] All existing tests pass.

## Implementation Plan

### Approach

1. Create `merge-scan.stub.ts` with the logged no-op.
2. Update `sign-in.handler.ts` to import from the canonical module path
   (replacing any inline stub from T002 if present).
3. Write a unit test spying on the import to verify call conditions.

### Files to Create

- `server/src/services/auth/merge-scan.stub.ts`

### Files to Modify

- `server/src/services/auth/sign-in.handler.ts` — import from canonical path.

### Testing Plan

- `tests/server/services/auth/merge-scan.test.ts`:
  - Spy on `mergeScan` import: called once when handler creates a new User.
  - Spy on `mergeScan` import: not called when handler finds an existing User.
  - Log output contains "Sprint 007" and the userId.

### Documentation Updates

None — the module file itself is self-documenting via its log message.
