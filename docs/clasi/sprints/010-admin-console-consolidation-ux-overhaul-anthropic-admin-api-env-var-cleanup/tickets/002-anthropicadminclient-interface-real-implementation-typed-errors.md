---
id: '002'
title: "AnthropicAdminClient — interface, real implementation, typed errors"
status: todo
use-cases:
  - SUC-010-006
  - SUC-010-007
  - SUC-010-008
depends-on: []
github-issue: ''
todo: plan-claude-team-account-management-real-admin-api-integration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# AnthropicAdminClient — interface, real implementation, typed errors

## Description

The existing `ClaudeTeamAdminClientImpl` targets fake/guessed endpoints
(`/organizations/{product_id}/members`) that do not exist. A real
`ANTHROPIC_ADMIN_API_KEY` is now available and confirmed working
(`GET /v1/organizations/me` returns The League org).

Create a new `AnthropicAdminClientImpl` under `server/src/services/anthropic/`
targeting real Anthropic Admin API endpoints. The old `claude-team/` module
is kept as a re-export shim for one release (T008 wires the new impl into
ServiceRegistry and existing tests).

## Acceptance Criteria

- [ ] `server/src/services/anthropic/anthropic-admin.client.ts` exists with `AnthropicAdminClient` interface and `AnthropicAdminClientImpl` class.
- [ ] Interface exposes all required methods: `listOrgUsers`, `getOrgUser`, `inviteToOrg`, `listInvites`, `cancelInvite`, `deleteOrgUser`, `listWorkspaces`, `addUserToWorkspace`, `removeUserFromWorkspace`.
- [ ] Auth header is `x-api-key: <key>` (not `Authorization: Bearer`). Header `anthropic-version: 2023-06-01` included on all requests.
- [ ] No `product_id` / `CLAUDE_TEAM_PRODUCT_ID` in the new implementation.
- [ ] Typed errors exported: `AnthropicAdminApiError` (non-2xx), `AnthropicAdminNotFoundError` (404), `AnthropicAdminWriteDisabledError` (write flag not set).
- [ ] `CLAUDE_TEAM_WRITE_ENABLED=1` kill switch enforced on all mutating methods.
- [ ] Pagination cursor handling: `listOrgUsers` and `listInvites` accept an optional `cursor` parameter; response includes `nextCursor`.
- [ ] Unit tests covering: 200 success, 401 → `AnthropicAdminApiError`, 404 → `AnthropicAdminNotFoundError`, 429 → `AnthropicAdminApiError`, write-disabled path; all against mocked `fetch`.
- [ ] `npm run test:server` passes.

## Implementation Plan

### New Files

**`server/src/services/anthropic/anthropic-admin.client.ts`**

Key types:
```typescript
interface AnthropicUser { id: string; email: string; role: string; name?: string }
interface AnthropicInvite { id: string; email: string; role: string; status: string; expires_at?: string }
interface AnthropicWorkspace { id: string; name: string }
```

Error classes mirror the `GoogleWorkspaceAdminClient` pattern: constructor takes
`message`, `method`, optional `statusCode`, optional `cause`.

Auth helper builds headers:
```
{ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
```

Write guard: checks `process.env.CLAUDE_TEAM_WRITE_ENABLED !== '1'` → throw `AnthropicAdminWriteDisabledError`.

Base URL: `https://api.anthropic.com/v1`

Real endpoint paths (confirmed from API docs):
- `GET /organizations/users` — list org users
- `GET /organizations/users/:id` — get org user
- `POST /organizations/invites` — send invite `{ email, role }`
- `GET /organizations/invites` — list invites
- `DELETE /organizations/invites/:id` — cancel invite
- `DELETE /organizations/users/:id` — delete org user
- `GET /organizations/workspaces` — list workspaces
- `POST /organizations/workspaces/:id/members` — add user to workspace
- `DELETE /organizations/workspaces/:id/members/:userId` — remove user from workspace

**`tests/server/services/anthropic/anthropic-admin.client.test.ts`**

Mock `fetch` globally. Test each error code path and one success path per
method. No real HTTP calls.

### Testing Plan

- `npm run test:server` — new test file + all existing tests pass.

### Notes

- Do not modify `server/src/services/claude-team/claude-team-admin.client.ts` in this ticket; that becomes the re-export shim in T008.
- `CLAUDE_TEAM_API_KEY` fallback is implemented in T008 (ServiceRegistry wiring), not here.
