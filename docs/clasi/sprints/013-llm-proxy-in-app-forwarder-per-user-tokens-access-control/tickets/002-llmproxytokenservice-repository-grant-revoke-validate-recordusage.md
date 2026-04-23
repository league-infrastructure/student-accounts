---
id: "002"
title: "LlmProxyTokenService + repository (grant, revoke, validate, recordUsage)"
status: todo
use-cases: ["SUC-013-001", "SUC-013-002", "SUC-013-003", "SUC-013-005"]
depends-on: ["001"]
github-issue: ""
todo: ""
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# LlmProxyTokenService + repository (grant, revoke, validate, recordUsage)

## Description

Build the domain layer for `LlmProxyToken`.

Files to create:

- `server/src/services/repositories/llm-proxy-token.repository.ts`
  — typed static CRUD:
  - `create(db, data)` — insert row; caller hashes token.
  - `findById(db, id)`
  - `findByHash(db, hash)` — for the proxy hot path.
  - `findActiveForUser(db, userId)` — `revoked_at IS NULL AND
    expires_at > now()`.
  - `listForUser(db, userId)` — ordered by `granted_at DESC`.
  - `incrementUsage(db, id, inputTokens, outputTokens)` — atomic
    `increment` using Prisma update + `increment:` on
    `tokens_used` and `request_count`.
  - `setRevokedAt(db, id, revokedAt)`.

- `server/src/services/llm-proxy-token.service.ts` —
  `LlmProxyTokenService`:
  - Constructor: `(prisma, audit)`.
  - Constants: `TOKEN_BYTES = 32`, `TOKEN_PREFIX = 'llmp_'`.
  - `async grant(userId, { expiresAt, tokenLimit }, actorId, opts?:
    { scope?: 'single'|'cohort'|'group'; scopeId?: number })` →
    `{ token: string; row: LlmProxyToken }`:
    1. Verify no active token exists (`findActiveForUser`). If one
       does, throw `ConflictError`.
    2. Generate plaintext: `TOKEN_PREFIX + randomBytes(32).toString('base64url')`.
    3. Hash: `sha256(plaintext)` (hex).
    4. Open a `prisma.$transaction`, insert the row, and write a
       `grant_llm_proxy_token` audit event with
       `target_user_id=userId`, `target_entity_type='LlmProxyToken'`,
       `target_entity_id=String(row.id)`, and `details={expiresAt,
       tokenLimit, scope: opts?.scope ?? 'single', scopeId:
       opts?.scopeId ?? null}`.
    5. Return `{token: plaintext, row}`. The plaintext is never
       persisted.
  - `async revoke(userId, actorId)` → `void`:
    1. `findActiveForUser`. If none, throw `NotFoundError`.
    2. Transaction: `setRevokedAt(row.id, now)`, audit
       `revoke_llm_proxy_token`.
  - `async getActiveForUser(userId)` → `LlmProxyToken | null`.
  - `async validate(token)` → `LlmProxyToken`:
    - Hash the token, `findByHash`. If missing or `revoked_at !=
      null`, throw `LlmProxyTokenUnauthorizedError('invalid or
      revoked')`.
    - If `expires_at < now()`, throw
      `LlmProxyTokenUnauthorizedError('expired')`.
    - If `tokens_used >= token_limit`, throw
      `LlmProxyTokenQuotaExceededError('quota exhausted')`.
    - Otherwise return the row.
  - `async recordUsage(tokenId, inputTokens, outputTokens)` → calls
    `LlmProxyTokenRepository.incrementUsage` with the passed values
    (and `request_count: 1`). Swallows errors and logs (best-effort
    accounting).

Error classes (exported from the service file):

- `LlmProxyTokenUnauthorizedError extends AppError` (statusCode 401).
- `LlmProxyTokenQuotaExceededError extends AppError` (statusCode
  429).

Service registry wiring:

- Add `readonly llmProxyTokens: LlmProxyTokenService` to
  `ServiceRegistry` + construct in constructor:
  `this.llmProxyTokens = new LlmProxyTokenService(defaultPrisma, this.audit)`.

Contract wiring (`server/src/contracts/index.ts` or equivalent):
extend the `req.services` typing to include `llmProxyTokens:
LlmProxyTokenService`.

## Acceptance Criteria

- [ ] `LlmProxyTokenRepository` exists and exports the methods
      listed above.
- [ ] `LlmProxyTokenService` exists and enforces the
      plaintext-never-persisted invariant.
- [ ] `grant` throws `ConflictError` when an active token exists.
- [ ] `grant` returns a plaintext token prefixed with `llmp_`.
- [ ] `revoke` throws `NotFoundError` when no active token exists.
- [ ] `validate` throws `LlmProxyTokenUnauthorizedError` for
      missing, revoked, and expired tokens.
- [ ] `validate` throws `LlmProxyTokenQuotaExceededError` when
      `tokens_used >= token_limit`.
- [ ] `recordUsage` atomically increments `tokens_used` and
      `request_count`.
- [ ] Audit events `grant_llm_proxy_token` and
      `revoke_llm_proxy_token` are written in the same transaction
      as the mutation.
- [ ] `ServiceRegistry` exposes `llmProxyTokens` and
      `req.services.llmProxyTokens` is typed.
- [ ] New tests pass (see Testing).
- [ ] `npm run test:server` and `npm run test:client` pass relative
      to the pre-existing drift list.

## Testing

- **Existing tests to run**: `npm run test:server` (full suite).
- **New tests to write**:
  - `tests/server/services/llm-proxy-token.service.test.ts`:
    - `grant` creates a row, returns plaintext with `llmp_` prefix,
      hash persisted is sha256(plaintext).
    - `grant` when active token present → `ConflictError`.
    - `grant` after a prior token was revoked → succeeds.
    - `revoke` flips `revoked_at`; audit event written.
    - `revoke` when none active → `NotFoundError`.
    - `validate` returns the row for a fresh token.
    - `validate` throws unauthorized for missing, revoked, expired.
    - `validate` throws quota-exceeded at `tokens_used ==
      token_limit`.
    - `recordUsage` increments counters.
- **Verification command**: `npm run test:server`.
