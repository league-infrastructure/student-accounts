---
id: '001'
title: 'Budget data model and token service: dollars, monthly period, request log,
  admin budget PATCH'
status: in-progress
use-cases:
- SUC-001
- SUC-006
depends-on: []
github-issue: ''
issue: llm-proxy-dollar-budgets-with-monthly-reset.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Budget data model and token service: dollars, monthly period, request log, admin budget PATCH

## Description

Make the proxy budget a monthly dollar amount. Add the budget columns and a per-request log to the data model, move quota enforcement in `LlmProxyTokenService` to dollars with a lazy monthly reset, make grants take a budget (default $5 from config), and expose the new fields and an admin budget PATCH. The forwarder still reports tokens only until ticket 002; `recordUsage` must accept the new shape now and compute `cost_usd` from the fallback price table when no cost is supplied, so this ticket is complete on its own.

## Acceptance Criteria

- [ ] Prisma: `LlmProxyToken` + `budget_usd Float?`, `spent_usd Float @default(0)`, `spent_usd_total Float @default(0)`, `period_start DateTime?`; new model `LlmProxyRequest { id, token_id (FK, cascade), user_id, ts @default(now()), protocol ('openai'|'anthropic' as String), model_requested String?, model_sent String?, input_tokens Int, output_tokens Int, cost_usd Float, status Int }` with indexes on `(token_id, ts)` and `(user_id, ts)`. Migration + generated client; test DB pushed. (Float, not Decimal: SQLite adapter friendliness; note it in the schema comment.)
- [ ] `server/src/services/llm-proxy-pricing.ts` (new): `TierPricing.costUsd(tier, inputTokens, outputTokens)` from config `LLM_PROXY_PRICE_LARGE/MEDIUM/SMALL` as `"<usd per 1M input>,<usd per 1M output>"` (defaults documented in `CONFIG_KEYS`, group "LLM Proxy"; pick current OpenRouter list prices for the default DeepSeek slugs and cite them in a comment). Also `tierFor(modelSent)` mapping a sent slug back to a tier via the three `LLM_PROXY_MODEL_*` values (fallback MEDIUM).
- [ ] `LlmProxyTokenService`:
  - `assertUsable(token)` (the pre-request check used by `llmProxyTokenAuth`): revoked/expired as before; then `rollPeriodIfNeeded(token, now)`: if `period_start` is null or before the first instant of the current UTC month, set `spent_usd = 0`, `period_start = <first of month>` (persist); then if `budget_usd != null` → throw `LlmProxyTokenQuotaExceededError('monthly budget of $X reached; resets <date>')` when `spent_usd >= budget_usd`; else legacy `tokens_used >= token_limit` check. `now` injectable for tests.
  - `recordUsage(tokenId, usage: { inputTokens, outputTokens, costUsd?: number|null, modelRequested?, modelSent?, protocol?: 'openai'|'anthropic', status?: number })`: cost = `costUsd ?? pricing.costUsd(tierFor(modelSent), in, out)`; increments `tokens_used`, `request_count`, `spent_usd`, `spent_usd_total`; inserts an `LlmProxyRequest` row. Keep the old positional call `recordUsage(id, input, output)` working (overload or adapter) so the current forwarder keeps compiling until ticket 002; fire-and-forget semantics unchanged.
  - `grant(...)` params gain `budgetUsd?: number` defaulting to `getConfig('LLM_PROXY_DEFAULT_BUDGET_USD')` (register, default `5`); `period_start` set at grant. `ensureActive` and `reconcileAccessFlags` pass the default. `bulk-llm-proxy.service.ts` accepts `budgetUsd`.
  - `setBudget(tokenId, budgetUsd, actorId)` with audit `llm_proxy_budget_changed { from, to }`; `backfillDefaultBudget(actorId)` sets `budget_usd = default` where null, returns count.
  - `periodResetsAt(token)`: first instant of next UTC month (ISO).
- [ ] Routes: `PATCH /api/admin/llm-proxy/tokens/:id` `{ budgetUsd }` (admin; 400 if not a positive number ≤ 1000); `POST /api/admin/llm-proxy/backfill-budgets` (admin). The existing admin token status payload(s) (`routes/admin/llm-proxy.ts`, `routes/admin/users.ts`) and `GET /api/account/llm-proxy`, `GET /api/account` `profile.llmProxy`, and `POST /api/fleet/llm-token` add `budgetUsd`, `spentUsd`, `spentUsdTotal`, `periodResetsAt`; the fleet response uses snake_case (`budget_usd`, `spent_usd`, `period_resets_at`) to match its existing keys. Grant endpoints (admin single + bulk + `LlmProxyGrantModal.tsx`) accept/show `budgetUsd` (token limit stays optional).
- [ ] Retention: the daily backup job (or a new daily job `llm-proxy-request-prune`) deletes `LlmProxyRequest` rows older than 90 days; test with a seeded old row.
- [ ] Tests: token-service tests with an injected clock for reset-at-new-month, enforcement at the cap, legacy null-budget path, cost fallback when `costUsd` absent, request-row insert; route tests for PATCH/backfill (403 non-admin, 400 bad value, audit row) and for the new fields on account + fleet payloads; prune job test.

## Testing

- **Existing tests to run**: full server suite (llm-proxy token/middleware/route tests, fleet, account, admin llm-proxy).
- **New tests to write**: `tests/server/services/llm-proxy-budget.test.ts`, `tests/server/services/llm-proxy-pricing.test.ts`, `tests/server/routes/admin/llm-proxy-budget.test.ts`, prune job test; extend `tests/server/routes/fleet.test.ts` and account llm-proxy route tests for the new fields.
- **Verification command**: `npm run test:server && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests). `npm run test:server` from the repo root (~4 min; not concurrently with other suites). `cd server && npx tsc --noEmit` clean. `cd server && npm run lint` has 12 pre-existing errors; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Baseline failures (may stay red, nothing else may go red): `tests/server/auth-flows.integration.test.ts`, `schema-t005.test.ts`, `services/claude-provisioning.service.test.ts`, `services/workspace-provisioning.service.test.ts`, `services/auth/google-admin-directory.client.test.ts`; plus rare single-test 404/ECONNRESET flakes under full-suite load (re-run the file in isolation before concluding).
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read `req.services`. Audit through `AuditService`.
- Prisma schema changes: edit `server/prisma/schema.prisma`, `cd server && npx prisma migrate dev --name <slug>` (dev DB from `.env`), `npx prisma generate` (`server/src/generated/` is gitignored), and `npx prisma db push --url file:./data/test.db` for the local test DB (not migration-managed).
- Commit on the sprint branch when the ticket's tests pass, message starting with `[003-NNN]`, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not bump the version.
- The issue files this sprint serves are in `clasi/sprints/003-llm-proxy-dollar-budgets-claude-code-and-visibility/issues/`.
