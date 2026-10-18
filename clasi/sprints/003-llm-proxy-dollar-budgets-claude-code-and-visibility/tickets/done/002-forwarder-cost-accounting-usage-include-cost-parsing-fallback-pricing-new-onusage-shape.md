---
id: '002'
title: 'Forwarder cost accounting: usage.include, cost parsing, fallback pricing,
  new onUsage shape'
status: done
use-cases:
- SUC-001
depends-on:
- '001'
github-issue: ''
issue: llm-proxy-dollar-budgets-with-monthly-reset.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Forwarder cost accounting: usage.include, cost parsing, fallback pricing, new onUsage shape

## Description

Make the forwarder report dollars. Ask OpenRouter to include cost (`usage: {include: true}`), parse `usage.cost` from non-streaming responses and from the final streaming chunk, and pass a structured usage report to the token service. Keep the passthrough behaviour (bytes piped unchanged to the client) exactly as now.

## Acceptance Criteria

- [x] `server/src/services/llm-proxy-forwarder.service.ts`: `onUsage` becomes `(usage: UsageReport) => void` with `UsageReport = { inputTokens, outputTokens, costUsd: number | null, modelRequested: string | null, modelSent: string, protocol: 'openai' | 'anthropic', status: number }` (exported). The OpenAI path sets `protocol: 'openai'`.
- [x] Request body gets `usage: { include: true }` merged in (preserve any client-supplied `usage` object fields) for both streaming and non-streaming; `stream_options.include_usage` injection unchanged.
- [x] Non-streaming: `costUsd = body.usage?.cost ?? null` (OpenRouter returns cost in USD credits in `usage.cost`). Streaming: read `usage.cost` from the chunk that carries `usage` (the last one), else null. Tokens parsed as today.
- [x] `routes/llm-proxy.ts` passes the report to `tokens.recordUsage(row.id, report)` (ticket 001's shape); the legacy positional overload can now be removed if nothing else uses it.
- [x] Error responses from upstream (4xx/5xx) still record a request row with `status` and zero tokens/cost when the body has no usage.
- [x] Tests (`tests/server/services/llm-proxy-forwarder.service.test.ts`): `usage.include` injected (non-stream and stream), cost parsed from both shapes, null cost when absent, client `usage` object merged not clobbered, report shape; route test asserts `recordUsage` receives the report and that a request row lands with `cost_usd` from the fallback when cost is null.

## Testing

- **Existing tests to run**: forwarder, llm-proxy route, token service tests; full suite.
- **New tests to write**: as above.
- **Verification command**: `npm run test:server && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests). `npm run test:server` from the repo root (~4 min; not concurrently with other suites). `cd server && npx tsc --noEmit` clean. `cd server && npm run lint` has 12 pre-existing errors; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Baseline failures (may stay red, nothing else may go red): `tests/server/auth-flows.integration.test.ts`, `schema-t005.test.ts`, `services/claude-provisioning.service.test.ts`, `services/workspace-provisioning.service.test.ts`, `services/auth/google-admin-directory.client.test.ts`; plus rare single-test 404/ECONNRESET flakes under full-suite load (re-run the file in isolation before concluding).
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read `req.services`. Audit through `AuditService`.
- Prisma schema changes: edit `server/prisma/schema.prisma`, `cd server && npx prisma migrate dev --name <slug>` (dev DB from `.env`), `npx prisma generate` (`server/src/generated/` is gitignored), and `npx prisma db push --url file:./data/test.db` for the local test DB (not migration-managed).
- Commit on the sprint branch when the ticket's tests pass, message starting with `[003-NNN]`, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not bump the version.
- The issue files this sprint serves are in `clasi/sprints/003-llm-proxy-dollar-budgets-claude-code-and-visibility/issues/`.
