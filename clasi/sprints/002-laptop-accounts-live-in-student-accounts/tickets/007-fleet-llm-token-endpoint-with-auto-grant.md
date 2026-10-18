---
id: '007'
title: Fleet LLM token endpoint with auto-grant
status: in-progress
use-cases:
- SUC-004
depends-on:
- '001'
github-issue: ''
issue: fleet-llm-token-endpoint-for-laptop-login.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Fleet LLM token endpoint with auto-grant

## Description

A machine endpoint the laptops call at login (`league-helper login`, with the student's password in hand) to fetch the student's LLM proxy token, the same `llmp_` token shown on their Account page. JSON only, no cookie. Auto-grant so laptop students never need an admin click. Throttled and audited.

## Acceptance Criteria

- [ ] `LlmProxyTokenService.ensureActive(userId, actorId, scope)` in `server/src/services/llm-proxy-token.service.ts`: returns the active token row (with plaintext) or grants one (`expiresAt: +1 year`, `tokenLimit: LLM_PROXY_DEFAULT_TOKEN_LIMIT`), also replacing an expired one; sets `allows_llm_proxy = true`.
- [ ] `server/src/routes/fleet.ts` mounted at `/api/fleet` in `app.ts`, public (no session): `POST /llm-token` and `POST /llm-token/rotate`, body `{ username, password }`. Verification exactly like `routes/auth/login.ts` but **without** the passphrase fallback, via `verifyPassword` (scrypt or `$6$`). Conditions: user exists, `is_active`, role student or staff. If `allows_llm_proxy` is false and the user has no `username`+`laptop_password_hash` → 403 `{ error: 'llm proxy not enabled' }`; otherwise `ensureActive`. Rotate = `revoke` then `ensureActive`.
- [ ] Response 200: `{ user_id, username, api_key, base_url: '<scheme>://<host>/proxy/v1', anthropic_base_url: '<scheme>://<host>/proxy' (only when config `LLM_PROXY_ANTHROPIC_ENABLED` is 'true'; omit otherwise), models: ['league-small','league-medium','league-large'], default_model: 'league-medium', token_limit, tokens_used, request_count, expires_at, granted_at }`; host derived as `GET /api/account` does for `endpoint`.
- [ ] 401 `{ error: 'Invalid username or password' }` (same body as login) for any credential failure; 429 `{ error: 'too many attempts' }` after 5 failures per username or per client IP within 15 minutes (in-memory `server/src/middleware/attemptLimiter.ts`, exported for tests with a reset hook); never log the password.
- [ ] Audit `fleet_llm_token_issued` (and `fleet_llm_token_rotated`) with `{ host: req.get('X-League-Host') ?? null }`.
- [ ] Config: `LLM_PROXY_ANTHROPIC_ENABLED` registered in `CONFIG_KEYS` (default false; sprint 003 turns it on).
- [ ] Tests (`tests/server/routes/fleet.test.ts`, supertest): 200 shape; same `api_key` on a second call; rotate changes it and the old one is rejected by `/proxy/v1/chat/completions` auth middleware (401); wrong password 401; 6th failure 429 and even a correct password is 429 while blocked; inactive user 401; user with `allows_llm_proxy=false` and no laptop credentials 403; a user with a `$6$` `password_hash` (imported) authenticates; `X-League-Host` lands in the audit row.

## Testing

- **Existing tests to run**: full server suite, especially LLM proxy token/middleware tests.
- **New tests to write**: `tests/server/routes/fleet.test.ts`, `tests/server/middleware/attemptLimiter.test.ts`.
- **Verification command**: `npm run test:server && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
