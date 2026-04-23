---
id: "007"
title: "BulkLlmProxyService + cohort/group bulk endpoints + UI buttons"
status: todo
use-cases: ["SUC-013-006", "SUC-013-007"]
depends-on: ["005"]
github-issue: ""
todo: ""
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# BulkLlmProxyService + cohort/group bulk endpoints + UI buttons

## Description

Deliver the bulk surface: grant/revoke LLM proxy access across a
whole cohort or group.

Server: create `server/src/services/bulk-llm-proxy.service.ts`:
`BulkLlmProxyService`.

Constructor: `(prisma, llmProxyTokens: LlmProxyTokenService,
userRepository, cohortRepository, groupRepository)`.

Methods:

- `bulkGrant(scope: { kind: 'cohort' | 'group'; id: number },
  params: { expiresAt: Date; tokenLimit: number }, actorId: number):
  Promise<{succeeded: number[]; failed: { userId: number; userName:
  string; error: string }[]; skipped: number[]; tokensByUser:
  Record<number, string>}>`. The `tokensByUser` map is the
  plaintext tokens keyed by userId so the admin UI can render a
  downloadable list. (Plaintext-once still holds: the tokens are
  returned in this single response and never re-fetched.)
  1. Resolve eligible users:
     - Cohort: `UserRepository.findByCohortId(..., {isActive:
       true})`.
     - Group: query `UserGroup` + `User` join, filtering
       `is_active=true`.
  2. For each user, run in its own `prisma.$transaction`:
     - If an active token already exists → push to `skipped` and
       continue.
     - Otherwise call `llmProxyTokens.grant(userId, params,
       actorId, { scope: scope.kind, scopeId: scope.id })`.
  3. Collect succeeded / failed / skipped + tokensByUser (only for
     `succeeded`). Never abort the whole batch on one failure.
- `bulkRevoke(scope, actorId)` → same shape but without plaintext
  tokens. Skipped = "no active token to revoke".

Admin routes in `server/src/routes/admin/llm-proxy.ts`:

- `POST /admin/cohorts/:id/llm-proxy/bulk-grant` — body
  `{expiresAt, tokenLimit}`. Same validation as T005 grant. Calls
  `bulkLlmProxy.bulkGrant({kind: 'cohort', id}, ...)`. Returns 200
  when `failed.length === 0`, 207 when partial failure, 404 when
  cohort missing.
- `POST /admin/cohorts/:id/llm-proxy/bulk-revoke` — calls
  `bulkLlmProxy.bulkRevoke`. Same status mapping.
- `POST /admin/groups/:id/llm-proxy/bulk-grant` — same shape, group
  scope.
- `POST /admin/groups/:id/llm-proxy/bulk-revoke` — same shape.

Service registry: add `readonly bulkLlmProxy: BulkLlmProxyService`;
construct with the other bulk services.

Client:

- `CohortDetailPanel.tsx`: add two new buttons under the existing
  bulk-action group: "Grant LLM Proxy to All" (opens a modal with
  the same expiry/cap inputs as UserLlmProxyCard) and "Revoke LLM
  Proxy from All" (confirm-before-fire). Render the response via
  the existing bulk-result pattern (`BulkActionDialog`). The
  response includes `tokensByUser`; show a collapsed "Copy all
  tokens (CSV)" block the admin can expand to grab the full list.
- `GroupDetailPanel.tsx`: same changes, but scoped to
  `/admin/groups/:id/llm-proxy/bulk-*`.

## Acceptance Criteria

- [ ] `BulkLlmProxyService.bulkGrant` returns `{succeeded, failed,
      skipped, tokensByUser}`; each succeeded entry has a plaintext
      token in the map.
- [ ] `bulkGrant` skips users that already have an active token
      (no duplicate grants).
- [ ] `bulkRevoke` skips users with no active token (no 404 per
      user).
- [ ] Partial failures return 207 Multi-Status; zero failures
      return 200; zero-eligible returns 200 with empty arrays.
- [ ] 404 returned when cohort / group id does not exist.
- [ ] `ServiceRegistry` exposes `bulkLlmProxy`; `req.services.bulkLlmProxy`
      is typed.
- [ ] `CohortDetailPanel.tsx` and `GroupDetailPanel.tsx` render the
      two new buttons and invoke the bulk endpoints; the plaintext
      tokens block is shown after a successful `bulkGrant`.
- [ ] New server + client tests pass.
- [ ] `npm run test:server` and `npm run test:client` pass relative
      to pre-existing drift.

## Testing

- **Existing tests to run**: `npm run test:server`,
  `npm run test:client`.
- **New tests to write**:
  - `tests/server/services/bulk-llm-proxy.service.test.ts`:
    - `bulkGrant` over a cohort with three active students →
      three tokens, all prefixed `llmp_`.
    - `bulkGrant` with one pre-existing active token → skipped
      count 1, succeeded count 2.
    - `bulkGrant` when one user insert throws → failed entry with
      error; other users still succeed.
    - `bulkRevoke` over a cohort — mirrors the above.
    - Group-scoped variants.
  - Extend `tests/server/admin-llm-proxy.routes.test.ts` (or add a
    sibling file) for the four bulk endpoints:
    - 200 happy path.
    - 207 on partial failure.
    - 404 on missing cohort / group.
    - 400 on bad expiresAt / tokenLimit.
  - `tests/client/CohortDetailPanel.test.tsx` (or a focused sibling
    test): new buttons trigger the right endpoints and render the
    result block.
  - Same for `GroupDetailPanel.test.tsx`.
- **Verification command**: `npm run test:server && npm run test:client`.
