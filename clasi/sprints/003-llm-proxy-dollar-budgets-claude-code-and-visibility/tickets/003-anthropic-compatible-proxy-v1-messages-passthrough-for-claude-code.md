---
id: '003'
title: Anthropic-compatible /proxy/v1/messages passthrough for Claude Code
status: in-progress
use-cases:
- SUC-002
depends-on:
- '002'
github-issue: ''
issue: anthropic-compatible-proxy-endpoint-for-claude-code.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Anthropic-compatible /proxy/v1/messages passthrough for Claude Code

## Description

Let Claude Code use the proxy. Add `POST /proxy/v1/messages`, an Anthropic-format passthrough to OpenRouter's Anthropic-compatible endpoint (`https://openrouter.ai/api/v1/messages`), with the same `llmp_` token auth, League tier mapping (extended to Claude model names), streaming preserved, usage parsed from Anthropic events, and the whole thing behind `LLM_PROXY_ANTHROPIC_ENABLED`. The pre-sprint-001 implementation of the Anthropic usage parsing is in git history: `git show 3e84f10^:server/src/services/llm-proxy-forwarder.service.ts` (see `message_start` / `message_delta` handling around lines 300-370); reuse it.

## Acceptance Criteria

- [ ] Config: `LLM_PROXY_ANTHROPIC_BASE_URL` (default `https://openrouter.ai/api/v1/messages`) registered; `LLM_PROXY_ANTHROPIC_ENABLED` default flipped to `'true'` (it was registered in sprint 002 with default false); both documented in `config/{dev,prod}/public.env`.
- [ ] Forwarder: `forwardAnthropicMessages(req, res, { onUsage })` sharing the fetch/stream/abort plumbing with the OpenAI path (refactor into a private `forward(upstreamUrl, headers, body, parse)` if that keeps it clean). Upstream headers: `Authorization: Bearer <OPENROUTER_API_KEY>`, pass through `anthropic-version` and `anthropic-beta` from the client, `content-type: application/json`, optional attribution headers as today. Body unchanged except `model` → tier slug. Response bytes piped unchanged (status, SSE framing).
- [ ] `mapModel()` extended: besides the existing exact matches, any model string containing `opus` → LARGE, `sonnet` → MEDIUM, `haiku` → SMALL (case-insensitive, substring), so Claude Code's `claude-sonnet-4-5-…`, `claude-opus-…`, `claude-haiku-…` resolve; unknown → MEDIUM. Unit-tested.
- [ ] Usage: non-streaming from `usage.input_tokens`/`usage.output_tokens` (plus `usage.cost` if OpenRouter includes it, else null); streaming from `message_start` (input) and the last `message_delta` (output, and cost if present). Report `protocol: 'anthropic'`.
- [ ] Route (`routes/llm-proxy.ts`): `POST /messages` with `express.json({ limit: '10mb' })` and `llmProxyTokenAuth` (already accepts `x-api-key` and Bearer); 404 JSON `{ error: 'anthropic endpoint disabled' }` when the flag is off; `POST /messages/count_tokens` → 404 JSON with a clear message (document; check whether OpenRouter supports it and pass through if so). CORS allow-headers add `anthropic-version`, `anthropic-beta`, `x-api-key`.
- [ ] `GET /proxy` self-doc (`app.ts`) lists both protocols and the env vars Claude Code needs; `GET /api/account/llm-proxy` returns `anthropicEnabled` and `anthropicEndpoint` (`<scheme>://<host>/proxy`); fleet endpoint already keys `anthropic_base_url` on the flag (verify).
- [ ] Tests: forwarder Anthropic fixtures (non-streaming JSON; streaming SSE with `message_start`, `content_block_delta`, `message_delta`, `message_stop`) assert usage report, header passthrough, model mapping; route tests: auth via `x-api-key` and Bearer, 401 bad token, 404 when disabled, quota 429 applies to this route too.

## Testing

- **Existing tests to run**: forwarder, llm-proxy routes, token service; full suite.
- **New tests to write**: as above (extend `tests/server/services/llm-proxy-forwarder.service.test.ts`, `tests/server/llm-proxy.routes.test.ts` or sibling).
- **Verification command**: `npm run test:server && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests). `npm run test:server` from the repo root (~4 min; not concurrently with other suites). `cd server && npx tsc --noEmit` clean. `cd server && npm run lint` has 12 pre-existing errors; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Baseline failures (may stay red, nothing else may go red): `tests/server/auth-flows.integration.test.ts`, `schema-t005.test.ts`, `services/claude-provisioning.service.test.ts`, `services/workspace-provisioning.service.test.ts`, `services/auth/google-admin-directory.client.test.ts`; plus rare single-test 404/ECONNRESET flakes under full-suite load (re-run the file in isolation before concluding).
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read `req.services`. Audit through `AuditService`.
- Prisma schema changes: edit `server/prisma/schema.prisma`, `cd server && npx prisma migrate dev --name <slug>` (dev DB from `.env`), `npx prisma generate` (`server/src/generated/` is gitignored), and `npx prisma db push --url file:./data/test.db` for the local test DB (not migration-managed).
- Commit on the sprint branch when the ticket's tests pass, message starting with `[003-NNN]`, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not bump the version.
- The issue files this sprint serves are in `clasi/sprints/003-llm-proxy-dollar-budgets-claude-code-and-visibility/issues/`.
