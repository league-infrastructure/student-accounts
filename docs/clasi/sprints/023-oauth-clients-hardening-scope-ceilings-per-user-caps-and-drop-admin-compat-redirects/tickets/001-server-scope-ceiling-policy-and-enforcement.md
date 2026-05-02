---
id: "001"
title: "Server — scope-ceiling policy and enforcement"
status: todo
use-cases:
  - SUC-023-003
  - SUC-023-004
depends-on: []
github-issue: ""
todo: ""
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server — scope-ceiling policy and enforcement

## Description

Sprint 020 allowed any authenticated user to register an OAuth client with
any scope, creating a privilege escalation path where a student could obtain
`users:read` access. This ticket closes that gap by introducing a
`ScopePolicy` module and enforcing it in the `create` and `update` paths of
`OAuthClientService`.

**Policy (from stakeholder direction 2026-05-01):**

| Role | Allowed Scopes |
|------|---------------|
| `student` | `profile` |
| `staff` | `profile`, `users:read` |
| `admin` | `profile`, `users:read` |

## Acceptance Criteria

- [ ] `server/src/services/oauth/scope-policy.ts` exists and exports:
  - `ScopePolicy.allowedScopesFor(role: string): string[]`
  - `ScopePolicy.assertAllowed(role: string, requestedScopes: string[]): void` — throws `ForbiddenError` when any requested scope is not in the allowed set.
- [ ] `OAuthClientService.create` is updated to accept `actor?: ActorContext` as a third argument (matching the pattern of `update`, `rotateSecret`, `disable`).
- [ ] When `actor` is provided to `create`, `ScopePolicy.assertAllowed(actor.actorRole, input.allowed_scopes)` is called before writing.
- [ ] `OAuthClientService.update` calls `ScopePolicy.assertAllowed` when `patch.allowed_scopes` is present and `actor` is provided.
- [ ] The POST `/oauth-clients` route handler passes `actorContext(req)` as the `actor` argument to `oauthClients.create`.
- [ ] Student create with `['profile']` → 201.
- [ ] Student create with `['users:read']` → 403.
- [ ] Student create with `['profile', 'users:read']` → 403.
- [ ] Student update with `['users:read']` → 403.
- [ ] Staff create with `['profile', 'users:read']` → 201.
- [ ] Admin create with `['profile', 'users:read']` → 201.
- [ ] Staff update with any valid scope → 201.
- [ ] No changes to `verifySecret`, `rotateSecret`, `disable`, or `list`.

## Implementation Plan

### Approach

Create `ScopePolicy` as a pure module with no dependencies (no Prisma, no
external imports). Enforce it in the service layer so the check applies
regardless of which route or client calls the service.

### Files to Create

- `server/src/services/oauth/scope-policy.ts` — policy table + two exports.

### Files to Modify

- `server/src/services/oauth/oauth-client.service.ts`:
  - Add `import { ScopePolicy } from './scope-policy.js'`
  - Change `create(input, actorUserId)` to `create(input, actorUserId, actor?: ActorContext)`
  - Add cap check call site (see ticket 002 — coordinate on the same `actor` parameter)
  - In `update`, after the ownership check, add scope check when `patch.allowed_scopes` is set
- `server/src/routes/oauth-clients.ts`:
  - POST handler: change `req.services.oauthClients.create(body, actor.actorUserId)` to `req.services.oauthClients.create(body, actor.actorUserId, actor)`

### Testing Plan

Extend `tests/server/routes/oauth-clients.test.ts`:
- Student + `users:read` → 403 (both create and update)
- Student + `profile` → 201
- Staff + `['profile','users:read']` → 201
- Admin + `['profile','users:read']` → 201

Optionally add a unit test for `ScopePolicy` directly (fast, no DB).

### Documentation Updates

Remove the `// TODO (sprint.md "Out of Scope: Scope ceilings")` comment from
`server/src/routes/oauth-clients.ts` if it exists there (the client-side TODO
is addressed in ticket 005).
