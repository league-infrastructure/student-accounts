---
id: '004'
title: 'Server: LLM proxy grant group permission gate (single + bulk paths)'
status: done
use-cases:
- SUC-004
depends-on:
- '002'
github-issue: ''
todo: ''
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: LLM proxy grant group permission gate (single + bulk paths)

## Description

Extend the LLM proxy token grant path so that grant attempts are blocked when the
target user has no group granting `allowsLlmProxy`. This applies to:

1. **Single grant** (`POST /admin/users/:id/llm-proxy-token`) — the admin grants a
   token for one specific user.
2. **Bulk grant** (`POST /admin/groups/:id/llm-proxy/bulk-grant`) — the admin bulk-grants
   tokens to group members; users without `allowsLlmProxy` are skipped (not hard-failed).

**No grandfather rule** for LLM proxy — unlike OAuth clients, there are no pre-existing
tokens to protect. (Existing active tokens remain valid; the gate only blocks new grants.)

**No revoking existing tokens** when `allowsLlmProxy` is toggled off — existing tokens
are grandfathered by inaction (not revoked).

## Acceptance Criteria

- [x] `LlmProxyTokenService.grant` accepts a `llmProxyAllowed?: boolean` option in `GrantOptions`.
- [x] When `llmProxyAllowed === false`, `grant` throws `ForbiddenError` with a message identifying `allowsLlmProxy`.
- [x] `POST /admin/users/:id/llm-proxy-token` route handler calls `GroupService.userPermissions(targetUserId)` and passes `.llmProxy` as `llmProxyAllowed`.
- [x] Target user in no llm-proxy group → `POST /admin/users/:id/llm-proxy-token` returns 403.
- [x] Target user in an llm-proxy group → grant succeeds (201).
- [x] Existing active tokens are NOT revoked when a group's `allowsLlmProxy` is toggled off.
- [x] Bulk grant path skips users without `allowsLlmProxy` (they appear in the `skipped` or `failed` field with a clear reason).
- [x] All existing LLM proxy token grant tests continue to pass.
- [x] New integration tests cover: denied (no group), permitted (has group), bulk skip.

## Implementation Plan

### Approach

1. Add `llmProxyAllowed?: boolean` to `GrantOptions` in
   `server/src/services/llm-proxy-token.service.ts`.
2. At the start of `grant()`, before the ConflictError check:
   ```typescript
   if (opts.llmProxyAllowed === false) {
     throw new ForbiddenError(
       'The target user has no group granting LLM proxy access (allowsLlmProxy).'
     );
   }
   ```
3. In `server/src/routes/admin/llm-proxy.ts`, POST handler:
   - Call `req.services.groups.userPermissions(userId)` where `userId` is the target.
   - Pass `llmProxyAllowed: perms.llmProxy` in the `GrantOptions` argument.
4. In `server/src/services/bulk-llm-proxy.service.ts`, `bulkGrant` per-user loop:
   - Call `GroupService.userPermissions(userId)` for each member.
   - Skip users where `!perms.llmProxy` (add to `failed` or `skipped` with reason).

### Files to modify

- `server/src/services/llm-proxy-token.service.ts` — extend `GrantOptions`; add gate
- `server/src/routes/admin/llm-proxy.ts` — pre-fetch permissions; pass `llmProxyAllowed`
- `server/src/services/bulk-llm-proxy.service.ts` — per-user permission check in bulk loop

### Testing plan

Extend `tests/server/routes/admin/llm-proxy.test.ts` (or create a new file):
- Target user in no llm-proxy group → POST → 403, message contains "allowsLlmProxy".
- Target user in an llm-proxy group → POST → 201.
- Bulk grant: mix of allowed and denied users → allowed get tokens, denied are skipped.

### Documentation updates

None required.
