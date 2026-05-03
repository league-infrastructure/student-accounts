---
id: '003'
title: 'Server: OAuthClientService.create group permission gate with grandfather bypass'
status: done
use-cases:
- SUC-003
depends-on:
- '002'
github-issue: ''
todo: ''
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: OAuthClientService.create group permission gate with grandfather bypass

## Description

Extend `OAuthClientService.create` so that non-admin users without a group granting
`allowsOauthClient` are rejected with 403, unless they already have at least one
non-disabled OAuth client (grandfather rule).

The gate slots after the existing cap and scope checks.

**Decision**: The route handler (`POST /api/oauth-clients` in
`server/src/routes/oauth-clients.ts`) pre-fetches permissions via
`GroupService.userPermissions(actorUserId)` and passes the result into `create` via the
`ActorContext`. This keeps `OAuthClientService` free of a GroupService dependency.

**Grandfather rule**: `grandfathered = existingClientCount > 0`. If grandfathered, skip
the group permission check. Rationale: preserve existing clients; the gate applies to
new registrations only.

## Acceptance Criteria

- [x] Non-admin user in no OAuth-client group, zero existing clients → `POST /api/oauth-clients` returns 403.
- [x] 403 error message identifies `allowsOauthClient` group permission as missing.
- [x] Non-admin user in an OAuth-client group → 201 (cap and scope rules still apply).
- [x] Non-admin user with one existing non-disabled client but no group permission → 201 (grandfather).
- [x] Admin user is never blocked by the group permission check.
- [x] All existing OAuth client route tests continue to pass.
- [x] New integration tests cover: denied (no group, no clients), permitted (group), grandfather (no group, has client), admin bypass.

## Implementation Plan

### Approach

1. Extend `ActorContext` in `oauth-client.service.ts` with an optional
   `userPermissions?: { oauthClient: boolean }` field.
2. In `OAuthClientService.create`, after the existing cap check, add:
   ```typescript
   if (actor && actor.actorRole !== 'admin') {
     const grandfathered = activeCount > 0; // activeCount already computed for cap check
     if (!grandfathered && !actor.userPermissions?.oauthClient) {
       throw new ForbiddenError(
         'Your account has no group granting the OAuth client permission (allowsOauthClient).'
       );
     }
   }
   ```
3. In `server/src/routes/oauth-clients.ts` POST handler, call
   `req.services.groups.userPermissions(actorUserId)` and add the result to the
   `ActorContext` before calling `oauthClients.create`.

### Files to modify

- `server/src/services/oauth/oauth-client.service.ts` — extend `ActorContext`, add gate
- `server/src/routes/oauth-clients.ts` — pre-fetch permissions; pass into `create`

### Testing plan

Extend `tests/server/routes/oauth-clients.test.ts` with:
- Student, no group, zero clients → POST → 403, message contains "allowsOauthClient".
- Student, in OAuth-client group → POST → 201.
- Student, no group, has one existing client → POST → 201 (grandfather; subject to cap).
- Admin, no group → POST → 201 (admin bypass).

### Documentation updates

None required.
