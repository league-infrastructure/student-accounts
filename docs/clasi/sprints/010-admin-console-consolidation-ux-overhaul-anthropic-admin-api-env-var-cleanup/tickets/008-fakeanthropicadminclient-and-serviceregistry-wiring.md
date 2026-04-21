---
id: 008
title: FakeAnthropicAdminClient and ServiceRegistry wiring
status: done
use-cases:
- SUC-010-006
depends-on:
- 010-002
github-issue: ''
todo: plan-claude-team-account-management-real-admin-api-integration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# FakeAnthropicAdminClient and ServiceRegistry wiring

## Description

Two tasks that must happen after T002 (AnthropicAdminClient) is complete:

1. **`FakeAnthropicAdminClient`**: Create an in-memory test double implementing
   the `AnthropicAdminClient` interface. Re-export it under both
   `FakeAnthropicAdminClient` and `FakeClaudeTeamAdminClient` so the 8
   existing test files that import `FakeClaudeTeamAdminClient` continue to
   compile without changes.

2. **`ServiceRegistry` wiring**: Add `anthropicAdmin: AnthropicAdminClient`
   property to `ServiceRegistry`. Wire `ANTHROPIC_ADMIN_API_KEY` as primary
   credential, falling back to `CLAUDE_TEAM_API_KEY`. Update the old
   `claude-team/claude-team-admin.client.ts` to be a re-export shim of the
   new implementation. Wire `ClaudeProvisioningService` and
   `ExternalAccountLifecycleService` to use `anthropicAdmin` from the registry.

## Acceptance Criteria

- [x] `tests/server/helpers/fake-anthropic-admin.client.ts` created. Implements all `AnthropicAdminClient` interface methods with in-memory data. Exported as both `FakeAnthropicAdminClient` and `FakeClaudeTeamAdminClient`.
- [x] The 8 existing test files that import `FakeClaudeTeamAdminClient` compile and pass without any import changes (the re-export handles this).
- [x] `ServiceRegistry` gains `readonly anthropicAdmin: AnthropicAdminClient`.
- [x] In `ServiceRegistry` constructor: `ANTHROPIC_ADMIN_API_KEY` used if set; falls back to `CLAUDE_TEAM_API_KEY`. `CLAUDE_TEAM_PRODUCT_ID` is no longer passed to the new client.
- [x] `server/src/services/claude-team/claude-team-admin.client.ts` is replaced with a re-export shim: re-exports all types and classes from `../anthropic/anthropic-admin.client`. Old error class names re-exported under their original names for backward compat.
- [x] `ClaudeProvisioningService` constructor updated to accept `AnthropicAdminClient` (injected from `ServiceRegistry.anthropicAdmin`).
- [x] `ExternalAccountLifecycleService` constructor updated similarly.
- [x] `npm run test:server` passes with zero new failures.

## Implementation Plan

### New Files

**`tests/server/helpers/fake-anthropic-admin.client.ts`**

Maintain in-memory arrays: `_users`, `_invites`, `_workspaces`, `_workspaceMembers`.
Implement each interface method against these arrays. Export:
```typescript
export { FakeAnthropicAdminClient };
export { FakeAnthropicAdminClient as FakeClaudeTeamAdminClient };
```

### Files to Modify

**`server/src/services/service.registry.ts`**
- Import `AnthropicAdminClientImpl` from `../anthropic/anthropic-admin.client`
- Add `readonly anthropicAdmin: AnthropicAdminClient`
- Constructor: `const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY ?? process.env.CLAUDE_TEAM_API_KEY ?? ''; this.anthropicAdmin = new AnthropicAdminClientImpl(apiKey);`
- Pass `this.anthropicAdmin` to `ClaudeProvisioningService` and `ExternalAccountLifecycleService`

**`server/src/services/claude-team/claude-team-admin.client.ts`**
- Replace body with re-exports from `../anthropic/anthropic-admin.client`
- Map old type names to new: `ClaudeTeamAdminClient` → re-export `AnthropicAdminClient`, etc.

**`server/src/services/claude-provisioning.service.ts`**
**`server/src/services/external-account-lifecycle.service.ts`**
- Update constructor parameter type from `ClaudeTeamAdminClient` → `AnthropicAdminClient`
- The existing `inviteMember` calls become `inviteToOrg` calls (update call sites)

### Testing Plan

- `npm run test:server` — all existing tests must pass.
- No new test scenarios needed here; the existing tests exercise the fake via `FakeClaudeTeamAdminClient` import.
