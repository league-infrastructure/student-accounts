---
id: "003"
title: "Pike13 write-back stub seam — no-op module at stable import path"
status: todo
use-cases: [UC-005]
depends-on: []
github-issue: ""
todo: ""
---

# Pike13 write-back stub seam — no-op module at stable import path

## Description

UC-005 step 6 calls for writing the new League email address back to the
user's Pike13 record after workspace provisioning. Sprint 006 implements the
real Pike13 client. This sprint must establish the call site at a stable import
path so Sprint 006 can replace the implementation without touching
`WorkspaceProvisioningService`.

This follows the same pattern as `merge-scan.stub.ts` from Sprint 002: a named
no-op function in its own module, logging that the feature is deferred.

This ticket can be implemented in parallel with T001 and T002 — it has no
dependencies.

## Acceptance Criteria

- [ ] File `server/src/services/pike13-writeback.stub.ts` is created.
- [ ] The module exports `leagueEmail(userId: number, email: string): Promise<void>`.
- [ ] The implementation logs at INFO level:
      `"pike13-writeback: leagueEmail deferred to Sprint 006 — no-op call site"`
      with `{ userId, email }` in the log context.
- [ ] The module exports `githubHandle(userId: number, handle: string): Promise<void>`
      (a stub for the other write-back function from UC-020, consistent with
      the spec — Sprint 006 will also need this).
- [ ] `githubHandle` logs equivalently: `"pike13-writeback: githubHandle deferred to Sprint 006"`.
- [ ] Neither function throws under any circumstance.
- [ ] The module is importable; a simple unit test (or smoke import) confirms
      both functions resolve without error.
- [ ] `npm test` passes.

## Implementation Plan

### Approach

Single new file. No dependencies. Minimal — this is purely a call-site
placeholder. Follow the `merge-scan.stub.ts` precedent exactly.

### Files to Create

- `server/src/services/pike13-writeback.stub.ts`

### Testing Plan

No dedicated test file needed beyond a smoke import. The functions are tested
implicitly through `WorkspaceProvisioningService` integration tests in T010.

### Documentation Updates

None. The stub's existence is documented in the architecture-update.md and
will be obvious from the function name and log message.
