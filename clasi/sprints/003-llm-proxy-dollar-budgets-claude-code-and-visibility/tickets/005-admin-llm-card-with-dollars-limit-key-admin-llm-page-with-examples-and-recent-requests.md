---
id: '005'
title: 'Admin: LLM card with dollars, limit, key; admin LLM page with examples and
  recent requests'
status: open
use-cases: [SUC-004, SUC-005]
depends-on: ['004']
github-issue: ''
issue: admin-llm-usage-visibility-and-dollar-limits.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Admin: LLM card with dollars, limit, key; admin LLM page with examples and recent requests

## Description

The admin side. The LLM card on a user's detail panel shows the dollar meter, an editable monthly limit, the masked key with reveal/copy, status, and links to the OpenRouter activity page and to a full admin LLM page for that student. The page renders the shared setup examples with the student's token and a recent-requests table from the request log.

## Acceptance Criteria

- [ ] Server: `GET /api/admin/users/:id/llm-proxy` returns `{ enabled, token, tokenMasked, budgetUsd, spentUsd, spentUsdTotal, periodResetsAt, tokenLimit, tokensUsed, requestCount, expiresAt, grantedAt, revokedAt, status, endpoint, anthropicEnabled, anthropicEndpoint, models }` (extend the existing status route in `routes/admin/llm-proxy.ts` or `users.ts`; keep the current fields); `GET /api/admin/users/:id/llm-proxy/requests?limit=50` returns recent `LlmProxyRequest` rows `{ ts, protocol, modelRequested, modelSent, inputTokens, outputTokens, costUsd, status }` newest first. Admin only.
- [ ] `client/src/pages/admin/UserLlmProxyCard.tsx`: dollar meter and `$x of $y · resets <date>` (token fallback when budget null); limit field (number, step 0.5) with Save → `PATCH /api/admin/llm-proxy/tokens/:id` (ticket 001) and a toast; status line; key row masked with Show / Copy; buttons: "Open LLM page" (→ `/admin/users/:id/llm-proxy`), "OpenRouter activity" (external `https://openrouter.ai/activity`, labelled account-wide), existing Grant/Revoke kept (Grant modal shows `budgetUsd` default $5).
- [ ] `client/src/pages/admin/UserLlmProxyPage.tsx` (new) + route `/admin/users/:id/llm-proxy` in `App.tsx` (admin-guarded like other admin routes): header with the student's name, the same figures and key controls, `LlmProxySetupExamples` with that student's token/endpoint, and a "Recent requests" table (time, protocol, model sent, tokens in/out, cost) with an empty state.
- [ ] Tests: route tests for the two endpoints (403 non-admin, shapes, requests ordering/limit); client tests for the card (limit save calls PATCH, Show reveals, Copy copies, dollar/token fallback) and the page (renders examples with the token; table rows; empty state).

## Testing

- **Existing tests to run**: admin panel client tests, `tests/client/pages/admin/UserDetailPanel.test.tsx`; server admin llm-proxy route tests; both full suites.
- **New tests to write**: `tests/server/routes/admin/llm-proxy-status.test.ts`, `tests/client/UserLlmProxyCard.test.tsx`, `tests/client/UserLlmProxyPage.test.tsx`.
- **Verification command**: `npm run test:client && npm run test:server && (cd client && npx tsc --noEmit) && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests). `npm run test:server` from the repo root (~4 min; not concurrently with other suites). `cd server && npx tsc --noEmit` clean. `cd server && npm run lint` has 12 pre-existing errors; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Baseline failures (may stay red, nothing else may go red): `tests/server/auth-flows.integration.test.ts`, `schema-t005.test.ts`, `services/claude-provisioning.service.test.ts`, `services/workspace-provisioning.service.test.ts`, `services/auth/google-admin-directory.client.test.ts`; plus rare single-test 404/ECONNRESET flakes under full-suite load (re-run the file in isolation before concluding).
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read `req.services`. Audit through `AuditService`.
- Prisma schema changes: edit `server/prisma/schema.prisma`, `cd server && npx prisma migrate dev --name <slug>` (dev DB from `.env`), `npx prisma generate` (`server/src/generated/` is gitignored), and `npx prisma db push --url file:./data/test.db` for the local test DB (not migration-managed).
- Commit on the sprint branch when the ticket's tests pass, message starting with `[003-NNN]`, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not bump the version.
- The issue files this sprint serves are in `clasi/sprints/003-llm-proxy-dollar-budgets-claude-code-and-visibility/issues/`.
