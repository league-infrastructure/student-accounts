---
id: '004'
title: 'Student: shared setup-examples component, tightened card, full /llm-proxy
  page'
status: open
use-cases: [SUC-003, SUC-006]
depends-on: ['001', '003']
github-issue: ''
issue: student-llm-proxy-page-with-setup-examples.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Student: shared setup-examples component, tightened card, full /llm-proxy page

## Description

The student side. One shared component renders setup examples for every tool with the student's real token and endpoint; the Account card shrinks to figures, key and one button; `/llm-proxy` becomes the full page. Wording stays provider-neutral (League tiers), as sprint 001 decided.

## Acceptance Criteria

- [ ] `client/src/components/llm-examples/` (new): one module per tool exporting `(ctx: { endpoint: string; token: string; models: string[]; anthropicEndpoint?: string }) => { title, body, howToTest }`: `claude-code.ts` (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY=""`, `ANTHROPIC_MODEL=league-large`, `ANTHROPIC_SMALL_FAST_MODEL=league-small`, then `claude`), `curl.ts` (chat/completions with `league-medium` + `/v1/models`), `continue.ts` (`~/.continue/config.yaml` entry: `provider: openai`, `apiBase: <endpoint>/v1`, `apiKey`, `model: league-medium`, `roles: [chat, edit, apply]`), `opencode.ts` (`~/.config/opencode/opencode.json` custom provider `league` with `npm: "@ai-sdk/openai-compatible"`, `options.baseURL`, `options.apiKey`, the three models, `"model": "league/league-medium"`), `hermes.ts` (`~/.hermes/config.yaml` `model: { provider: custom, base_url: <endpoint>/v1, default: league-medium }` + `hermes config set OPENAI_API_KEY <token>`; add a one-line caveat to verify keys against Hermes docs), `python.ts` (OpenAI SDK), `env.ts` (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, model names). Pure functions; snapshot-tested.
- [ ] `client/src/components/LlmProxySetupExamples.tsx` (new): props `{ endpoint, token, models, anthropicEnabled, anthropicEndpoint }`; renders each example as a section/tab with a Copy button (clipboard) and the "how to test" line; Claude Code shown only when `anthropicEnabled`. Replaces `LlmProxyUsage.tsx` (delete it or reduce to a re-export).
- [ ] `client/src/pages/account/AccountLlmProxyCard.tsx`: shows `$x.xx of $y.yy this month · resets <date>` (falls back to `n / m tokens` when `budgetUsd` is null), status (active/expired/revoked/disabled), masked key with Copy, and one button "Set up and details" → `/llm-proxy`. No code blocks. "Not enabled. Ask an instructor." when there is no token.
- [ ] `client/src/pages/LlmProxy.tsx`: header (key with Show/Copy, endpoint with Copy, meter, reset date, request count), then `LlmProxySetupExamples`. Data from `GET /api/account/llm-proxy`, which now also returns `models` (from the tier list; reuse the `/proxy/v1/models` list server-side) and `anthropicEnabled`/`anthropicEndpoint` (ticket 003).
- [ ] `client/src/pages/Account.tsx` Features section: copy updated to point at the page; no snippets.
- [ ] Tests: snapshot/contents tests for every template (contains token and endpoint; Claude template contains both ANTHROPIC vars); component test (Claude hidden when disabled; Copy writes the exact text); card test (no `<pre>`, button present, dollar vs token fallback); page test.

## Testing

- **Existing tests to run**: `tests/client/pages/Account.test.tsx`, llm proxy client tests; full client suite; server suite for the account route change.
- **New tests to write**: `tests/client/llm-examples.test.ts`, `tests/client/LlmProxySetupExamples.test.tsx`, `tests/client/AccountLlmProxyCard.test.tsx`, `tests/client/LlmProxyPage.test.tsx`.
- **Verification command**: `npm run test:client && npm run test:server && (cd client && npx tsc --noEmit) && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests). `npm run test:server` from the repo root (~4 min; not concurrently with other suites). `cd server && npx tsc --noEmit` clean. `cd server && npm run lint` has 12 pre-existing errors; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Baseline failures (may stay red, nothing else may go red): `tests/server/auth-flows.integration.test.ts`, `schema-t005.test.ts`, `services/claude-provisioning.service.test.ts`, `services/workspace-provisioning.service.test.ts`, `services/auth/google-admin-directory.client.test.ts`; plus rare single-test 404/ECONNRESET flakes under full-suite load (re-run the file in isolation before concluding).
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read `req.services`. Audit through `AuditService`.
- Prisma schema changes: edit `server/prisma/schema.prisma`, `cd server && npx prisma migrate dev --name <slug>` (dev DB from `.env`), `npx prisma generate` (`server/src/generated/` is gitignored), and `npx prisma db push --url file:./data/test.db` for the local test DB (not migration-managed).
- Commit on the sprint branch when the ticket's tests pass, message starting with `[003-NNN]`, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not bump the version.
- The issue files this sprint serves are in `clasi/sprints/003-llm-proxy-dollar-budgets-claude-code-and-visibility/issues/`.
