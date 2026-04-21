---
id: '005'
title: ProvisioningRequestService auto-chain and admin post-login redirect
status: todo
use-cases:
  - SUC-010-001
  - SUC-010-003
depends-on: []
github-issue: ''
todo: plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# ProvisioningRequestService auto-chain and admin post-login redirect

## Description

Two small server-side changes that have no dependencies on other sprint tickets:

1. **Auto-chain**: When an admin approves a `claude` ProvisioningRequest for a
   student who has no active workspace ExternalAccount, automatically provision
   the workspace first, then the Claude seat. No second admin action required.

2. **Post-login redirect**: Admin OAuth callbacks currently redirect to
   `/admin/provisioning-requests`. Change to redirect to `/` (the new Dashboard).

## Acceptance Criteria

**Auto-chain:**
- [ ] `ProvisioningRequestService.approve()` detects `requestType === 'claude'` + no active workspace ExternalAccount for the target user.
- [ ] On detection, calls `WorkspaceProvisioningService.provision(user, actor)` followed by `ClaudeProvisioningService.provision(user, actor)`.
- [ ] A single `request_approved` AuditEvent is recorded with `details.auto_chained = true`.
- [ ] If the user is not a student, the existing `UnprocessableError` is thrown unchanged.
- [ ] `ProvisioningRequestService` test suite includes a scenario: Claude request + no workspace → auto-chain produces both ExternalAccounts.
- [ ] Existing `approve()` tests continue to pass.

**Post-login redirect:**
- [ ] Admin OAuth callback in `server/src/routes/auth.ts` redirects to `/` not `/admin/provisioning-requests`.
- [ ] Staff redirect (`/staff/directory`) is unchanged.
- [ ] Student redirect (`/account`) is unchanged.

## Implementation Plan

### Files to Modify

**`server/src/services/provisioning-request.service.ts`**

In `approve()`, after loading the user:
```typescript
if (request.requestType === 'claude') {
  const activeWorkspace = await prisma.externalAccount.findFirst({
    where: { userId: user.id, type: 'workspace', status: 'active' }
  });
  if (!activeWorkspace) {
    // Auto-chain: provision workspace first
    await this.workspaceProvisioning.provision(user, actor);
    // Then fall through to existing Claude provisioning below
    auditDetails.auto_chained = true;
  }
}
```

Add `workspaceProvisioning: WorkspaceProvisioningService` to the constructor
(inject via `ServiceRegistry`). Check how `ClaudeProvisioningService` is
currently injected to follow the same pattern.

**`server/src/routes/auth.ts`**

Find the admin post-login redirect (likely in both Google and GitHub callbacks).
Change `'/admin/provisioning-requests'` → `'/'`.

Grep for the current redirect value before editing to ensure both OAuth paths
are caught:
```
grep -n "admin/provisioning-requests" server/src/routes/auth.ts
```

### Testing Plan

**`tests/server/services/provisioning-request.service.test.ts`**
- New scenario: Claude request approved for student with no workspace →
  `workspaceProvisioning.provision` called, then `claudeProvisioning.provision` called,
  AuditEvent has `auto_chained: true`.
- Existing scenarios: workspace request, claude request for student WITH existing
  workspace — verify those paths are unchanged.

Run `npm run test:server`.
