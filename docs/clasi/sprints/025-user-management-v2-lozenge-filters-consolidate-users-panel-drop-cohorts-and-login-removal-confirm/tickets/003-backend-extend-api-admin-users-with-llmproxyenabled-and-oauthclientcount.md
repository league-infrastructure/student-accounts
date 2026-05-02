---
id: '003'
title: 'Backend: extend /api/admin/users with llmProxyEnabled and oauthClientCount'
status: done
use-cases:
- SUC-003
- SUC-004
- SUC-006
depends-on: []
github-issue: ''
todo: ''
completes_todo: false
---

# Backend: extend /api/admin/users with llmProxyEnabled and oauthClientCount

## Description

The client-side lozenge filters in ticket 005 need two data points that are
not currently returned by `GET /api/admin/users`:

- `llmProxyEnabled: boolean` — needed for the "LLM Proxy" feature toggle. A
  user has LLM proxy enabled when they have at least one `LlmProxyToken` row
  where `expires_at > now()` AND `revoked_at IS NULL`.
- `oauthClientCount: number` — needed for the "OAuth Client" feature toggle.
  This is the count of `OAuthClient` rows where `created_by = user.id`.

Both are derivable from existing relations; no schema changes are required.

The current `serializeUser` function in `server/src/routes/admin/users.ts`
does not include these fields. The `GET /api/admin/users` Prisma query must
be extended to load the required relations.

## Acceptance Criteria

- [x] `GET /api/admin/users` response includes `llmProxyEnabled: boolean` on each user object.
- [x] `llmProxyEnabled` is `true` if and only if the user has at least one `LlmProxyToken` with `expires_at > now()` and `revoked_at IS NULL`.
- [x] `GET /api/admin/users` response includes `oauthClientCount: number` on each user object.
- [x] `oauthClientCount` equals the count of `OAuthClient` rows created by the user.
- [x] A backend test asserts both fields appear with correct values for: (a) a user with an active LLM proxy token, (b) a user with a revoked or expired token, (c) a user with no token. And: (a) a user with two OAuth clients, (b) a user with zero OAuth clients.
- [x] Existing tests for `GET /api/admin/users` continue to pass (update any that snapshot the full response shape).

## Implementation Plan

### Approach

In `server/src/routes/admin/users.ts` `GET /admin/users` query:

1. Add `_count: { select: { oauth_clients_created: true } }` to the Prisma
   `include` clause.
2. Add `llm_proxy_tokens: { where: { expires_at: { gt: new Date() }, revoked_at: null }, select: { id: true }, take: 1 }` to the `include` clause.
3. In `serializeUser`, compute:
   - `llmProxyEnabled: (user.llm_proxy_tokens?.length ?? 0) > 0`
   - `oauthClientCount: user._count?.oauth_clients_created ?? 0`

Note: the `_count` approach requires the Prisma query to use `include` for
relations and add `_count` at the top level. Verify the exact Prisma syntax
for combining `include` and `_count` in the same query (they may need to be
merged into a single `include` block with a nested `_count`).

### Files to modify

- `server/src/routes/admin/users.ts` — extend Prisma query and `serializeUser`

### Testing plan

- `tests/server/routes/admin/users.test.ts` (extend existing): seed a user with an active LlmProxyToken and one with no token. Assert `llmProxyEnabled` values. Seed a user with two OAuthClient rows. Assert `oauthClientCount`. Run: `npm run test:server -- --testPathPattern users`

### Documentation updates

None required.
