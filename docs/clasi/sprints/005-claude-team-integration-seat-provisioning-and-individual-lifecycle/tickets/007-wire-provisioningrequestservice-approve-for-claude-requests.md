---
id: "007"
title: "Wire ProvisioningRequestService.approve for Claude requests"
status: done
use-cases: [SUC-001]
depends-on: ["004"]
---

# Wire ProvisioningRequestService.approve for Claude requests

## Description

Sprint 004 left a `TODO(Sprint 005)` in `ProvisioningRequestService.approve`
for the claude path. When `requested_type === 'claude'`, the approve method
currently logs "deferred to Sprint 005" and does nothing. This ticket fills
that seam.

Change the `else` branch (claude path) in `approve()` to call
`claudeProvisioningService.provision(userId, deciderId, tx)` inside the same
transaction — exactly mirroring what the workspace path does for
`workspaceProvisioningService`.

`ClaudeProvisioningService` is injected as a constructor dependency alongside
the existing `WorkspaceProvisioningService`.

## Acceptance Criteria

- [x] `ProvisioningRequestService` constructor accepts an optional `ClaudeProvisioningService` parameter.
- [x] `approve()` for claude requests calls `claudeProvisioningService.provision(...)`.
- [x] If `ClaudeProvisioningService` is not injected and a claude request is approved, an error is thrown (same guard pattern as workspace).
- [x] `ServiceRegistry` passes `ClaudeProvisioningService` to `ProvisioningRequestService`.
- [x] Existing workspace approval tests continue to pass.
- [x] Integration tests for claude approval pass.

## Implementation Plan

### Approach

1. Update `ProvisioningRequestService` constructor to accept
   `claudeProvisioningService?: ClaudeProvisioningService`.
2. In `approve()`, replace the TODO log in the `else` branch with:
   ```
   if (!this.claudeProvisioningService) throw new Error('...');
   await this.claudeProvisioningService.provision(userId, deciderId, tx);
   ```
3. Update `ServiceRegistry` to inject `ClaudeProvisioningService` into
   `ProvisioningRequestService`.

### Files to modify

- `server/src/services/provisioning-request.service.ts`
- `server/src/services/service.registry.ts`

### Testing plan

Integration tests in `tests/server/services/provisioning-request.service.test.ts`
(extend existing file):
- Claude request approval: provision called, ExternalAccount created, request status=approved, audit event.
- Claude request approval failure: provision throws, request stays pending (rollback).
- Workspace request approval: unchanged behavior verified.

### Documentation updates

None.
