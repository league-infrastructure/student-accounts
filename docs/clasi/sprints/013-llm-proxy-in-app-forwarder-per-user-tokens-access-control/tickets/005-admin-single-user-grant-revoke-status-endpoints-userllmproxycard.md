---
id: '005'
title: Admin single-user grant/revoke/status endpoints + UserLlmProxyCard
status: done
use-cases:
- SUC-013-001
- SUC-013-002
depends-on:
- '002'
github-issue: ''
todo: ''
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Admin single-user grant/revoke/status endpoints + UserLlmProxyCard

## Description

Build the admin-facing single-user grant/revoke/status surface.

Server: create `server/src/routes/admin/llm-proxy.ts` exporting
`adminLlmProxyRouter`. Routes live beneath the existing
`/api/admin` mount. All routes require admin role (inherited from
`adminRouter`).

Routes in this ticket (cohort/group bulk routes land in T007):

- `POST /admin/users/:id/llm-proxy-token` — body `{expiresAt:
  ISO8601 string, tokenLimit: number}`. Validation:
  - `expiresAt` must parse to a Date in the future → 400 otherwise.
  - `tokenLimit` must be an integer `> 0` → 400 otherwise.
  Load the target user (`UserRepository.findByIdIncludingInactive`);
  404 if missing. Delegate to
  `req.services.llmProxyTokens.grant(userId, {expiresAt, tokenLimit},
  actorId, { scope: 'single' })`. Return 201 with `{token,
  tokenId, expiresAt, tokenLimit}`. Catch `ConflictError` and emit
  409.
- `DELETE /admin/users/:id/llm-proxy-token` — 204 on success.
  `NotFoundError` → 404.
- `GET /admin/users/:id/llm-proxy-token` — returns:
  - `{enabled: false}` if no active token.
  - `{enabled: true, tokenId, tokensUsed, tokenLimit, expiresAt,
    grantedAt, revokedAt}` otherwise (no plaintext, no hash).

Mount the router from `server/src/routes/admin/index.ts` alongside
the other `adminRouter.use('/admin', ...)` entries:

```ts
import { adminLlmProxyRouter } from './llm-proxy';
...
adminRouter.use('/admin', adminLlmProxyRouter);
```

Client: `client/src/pages/admin/UserLlmProxyCard.tsx` — a card
inserted into `UserDetailPanel.tsx` between the identity card and
the external-account cards. It:

- Fetches `GET /api/admin/users/:id/llm-proxy-token` on mount.
- When disabled: renders "LLM proxy: not enabled" and a "Grant
  access" button that opens an inline form with:
  - Expiration (`<input type="datetime-local">`, default +30 days
    from now).
  - Token cap (number input, default 1,000,000, step 100,000).
  - Submit button calls POST; on 201 the card stores the plaintext
    in component state and renders a one-shot "Token (copy before
    leaving this page)" panel with Copy button + instructions to
    share with the student. A "Dismiss" button clears it and
    re-fetches the status (which will now return `enabled: true`
    with no plaintext).
- When enabled: renders quota (`tokens_used / token_limit`),
  expiry, granted-at. "Revoke" button → DELETE.

The card is gated behind the same admin-only route protections the
rest of `UserDetailPanel.tsx` has (the parent enforces the role).

## Acceptance Criteria

- [x] `POST /api/admin/users/:id/llm-proxy-token` returns 201 with
      `{token, tokenId, expiresAt, tokenLimit}` when no active
      token exists.
- [x] Returns 409 when an active token already exists.
- [x] Returns 404 when the user does not exist.
- [x] Returns 400 when `expiresAt` is past or malformed, or
      `tokenLimit` is not a positive integer.
- [x] `DELETE /api/admin/users/:id/llm-proxy-token` returns 204
      when the active token was revoked, 404 otherwise.
- [x] `GET /api/admin/users/:id/llm-proxy-token` returns
      `{enabled: true, tokensUsed, tokenLimit, expiresAt, ...}`
      without the plaintext or hash when active; returns
      `{enabled: false}` otherwise.
- [x] `UserLlmProxyCard.tsx` renders all three states (disabled,
      grant-flow with plaintext shown once, enabled).
- [x] The plaintext token appears in the UI exactly once — only
      from the POST response, never from the GET.
- [x] New server + client tests pass.
- [x] `npm run test:server` and `npm run test:client` pass relative
      to pre-existing drift.

## Testing

- **Existing tests to run**: `npm run test:server`,
  `npm run test:client`.
- **New tests to write**:
  - `tests/server/admin-llm-proxy.routes.test.ts`:
    - 201 on grant with valid inputs.
    - 400 on past `expiresAt`.
    - 400 on zero/negative `tokenLimit`.
    - 409 on duplicate active grant.
    - 404 on unknown user id (both POST and DELETE).
    - 204 on revoke; 404 when none active.
    - GET returns enabled + disabled shapes correctly.
    - GET does not leak plaintext or hash.
  - `tests/client/UserLlmProxyCard.test.tsx`:
    - Renders disabled state for a user with no token.
    - Grant flow shows plaintext once after POST and hides it on
      Dismiss.
    - Enabled state renders quota and expiry.
    - Revoke click calls DELETE.
- **Verification command**: `npm run test:server && npm run test:client`.
