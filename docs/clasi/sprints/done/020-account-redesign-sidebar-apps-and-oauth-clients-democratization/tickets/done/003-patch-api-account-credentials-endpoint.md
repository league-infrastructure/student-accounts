---
id: '003'
title: PATCH api account credentials endpoint
status: done
use-cases:
- SUC-020-001
depends-on: []
github-issue: ''
todo: plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# PATCH /api/account/credentials endpoint

## Description

Add an endpoint that lets a passphrase-credentialed user edit their
own username and/or password. See `architecture-update.md` § "Modified
Modules (Server)" and use case **SUC-020-001**.

**Route.** Add `PATCH /credentials` to
`server/src/routes/account.ts` (mounts under `/api/account`, so the
public path is `PATCH /api/account/credentials`). Body schema:

```ts
{
  username?: string;
  currentPassword: string;
  newPassword?: string;
}
```

`currentPassword` is always required; `username` and/or `newPassword`
must be present (at least one) — empty body is a 400. Delegate to
`userService.updateCredentials(actorUserId, patch)` and return the
updated `{ id, username }` (no `password_hash`).

**Service.** Add
`updateCredentials(userId, { username?, currentPassword, newPassword? })`
to `server/src/services/user.service.ts`. Reuses the existing scrypt
helpers `hashPassword` and `verifyPassword` from
`server/src/utils/password.ts` (already used by
`server/src/services/auth/passphrase-signup.handler.ts`). Logic:

1. Load the user by id; if missing → throw NotFound (route maps to 401
   defensively, since the user is supposed to be the actor).
2. Verify `currentPassword` against the stored `password_hash` via
   `verifyPassword`. Mismatch → typed auth error mapped to **401**.
3. If `newPassword` present and non-empty, hash via `hashPassword`,
   set `password_hash`. Empty / whitespace-only `newPassword` → **400**
   typed validation error.
4. If `username` present, validate basic shape (non-empty, trimmed,
   sensible length cap — match whatever the signup handler uses) and
   set it. Rely on Prisma's `username` unique constraint as the
   authority for race-safe uniqueness — catch
   `Prisma.PrismaClientKnownRequestError` with code `P2002` and
   translate to a typed conflict error → **409**.
5. Update + return `{ id, username }`.

Use the existing typed-error pattern in the codebase (mirror what
other services do — search for `class ForbiddenError` or
`class ValidationError` and follow that pattern; reuse, don't
invent).

**Audit.** Write an `account_credentials_updated` audit event
(actor = userId, metadata = `{ updated_username: bool, updated_password: bool }`)
on success — match the audit-event style of neighboring services.

## Acceptance Criteria

- [x] `PATCH /api/account/credentials` exists in `server/src/routes/account.ts`.
- [x] `userService.updateCredentials` exists in `server/src/services/user.service.ts`.
- [x] Wrong `currentPassword` → 401.
- [x] Username already taken → 409 (translated from Prisma P2002).
- [x] Empty / whitespace `newPassword`, or empty body, → 400.
- [x] Successful response shape is `{ id, username }`; no `password_hash` leaked.
- [x] Audit event written on success.
- [x] Reuses `hashPassword` / `verifyPassword` from `server/src/utils/password.ts` — no new scrypt code.
- [x] `npm run test:server` passes.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write** (`tests/server/routes/account-credentials.test.ts`, or extend `account.test.ts`):
  - Happy path: change password only — response 200, returns `{ id, username }`, can log in with the new password (verify via `verifyPassword` against the persisted hash).
  - Happy path: change username only — response 200, persisted.
  - Happy path: change both in one request.
  - Wrong `currentPassword` → 401, no DB change.
  - Username collision (seed another user with the desired username) → 409.
  - Empty body / no fields besides `currentPassword` → 400.
  - Empty-string `newPassword` → 400.
  - Unauthenticated request → 401 from `requireAuth`.
  - Response body never contains `password_hash`.
- **Verification command**: `npm run test:server -- account-credentials`
