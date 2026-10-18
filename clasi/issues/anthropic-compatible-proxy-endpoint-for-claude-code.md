---
status: pending
sprint: '003'
---

# Anthropic-compatible proxy endpoint so Claude Code works through the League proxy

## Context

Sprint 001 removed `POST /proxy/v1/messages` and made the proxy
OpenAI-only (Chat Completions passthrough to OpenRouter). The stakeholder
now wants "how to set it up for Claude" on the student and admin pages.
Claude Code speaks only the Anthropic Messages protocol
(`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`). OpenRouter exposes an
**Anthropic-compatible endpoint** at `https://openrouter.ai/api/v1/messages`
(the "Anthropic skin"), accepting Anthropic request/response shapes with
OpenRouter model slugs, so the proxy can pass Anthropic-format requests
through **without translation**, exactly as it does for OpenAI format.

## Scope

- `POST /proxy/v1/messages`: bearer or `x-api-key` auth with the same
  `llmp_` token; League tier mapping on `model`; passthrough to
  OpenRouter's Anthropic endpoint; streaming preserved; usage recorded.
- `GET /proxy/v1/models` unchanged; the `/proxy` self-doc lists both
  protocols.
- Feature flag `LLM_PROXY_ANTHROPIC_ENABLED` (default true once verified)
  surfaced to the client as `anthropicEnabled`.

## Design

**Route** (`routes/llm-proxy.ts`): `POST /messages` with
`express.json({limit: '10mb'})`, `llmProxyTokenAuth` (it already accepts
`x-api-key`), then `forwarder.forwardAnthropicMessages(req, res, {onUsage})`.
CORS allow-headers add back `anthropic-version`, `anthropic-beta`,
`x-api-key`. Also accept `POST /proxy/v1/messages/count_tokens` → 404
JSON with a clear message (Claude Code tolerates it) unless OpenRouter
supports it; check at implementation.

**Forwarder** (`llm-proxy-forwarder.service.ts`): a second method sharing
the fetch/stream/abort plumbing. Upstream URL from config
`LLM_PROXY_ANTHROPIC_BASE_URL` (default
`https://openrouter.ai/api/v1/messages`); headers `Authorization: Bearer
<OPENROUTER_API_KEY>` plus pass through `anthropic-version` and
`anthropic-beta` from the client; body unchanged except `model` → tier
slug via the existing `mapModel()` (Claude Code sends names like
`claude-sonnet-4-5`; add a rule: anything containing `opus` → LARGE,
`sonnet` → MEDIUM, `haiku` → SMALL, which `mapModel` already does for the
bare words; extend the match to substrings). Usage: non-streaming from
`usage.input_tokens` / `usage.output_tokens`; streaming from the
`message_start` event (input) and the final `message_delta` (output). The
pre-sprint-001 implementation of exactly this parsing is in git history
(`git show 3e84f10^:server/src/services/llm-proxy-forwarder.service.ts`);
reuse it. Cost: if OpenRouter includes `usage.cost` on this endpoint, use
it; otherwise the per-tier fallback prices from the budgets issue.

**Token headers.** Claude Code sends `x-api-key` when `ANTHROPIC_API_KEY`
is set and `Authorization: Bearer` when `ANTHROPIC_AUTH_TOKEN` is set.
The instructions use `ANTHROPIC_AUTH_TOKEN` and set `ANTHROPIC_API_KEY=""`.

**Self-doc and client.** `GET /proxy` lists `chat/completions` and
`messages`; `GET /api/account/llm-proxy` returns `anthropicEnabled`;
the Claude Code example in `student-llm-proxy-page-with-setup-examples.md`
turns on.

## Files

- `server/src/routes/llm-proxy.ts`, `server/src/services/llm-proxy-forwarder.service.ts`,
  `server/src/services/config.ts` (`LLM_PROXY_ANTHROPIC_BASE_URL`,
  `LLM_PROXY_ANTHROPIC_ENABLED`), `server/src/app.ts` (self-doc),
  `server/src/routes/account.ts`
- Tests: extend `tests/server/services/llm-proxy-forwarder.service.test.ts`
  with Anthropic non-streaming and streaming fixtures (usage parsed from
  `message_start`/`message_delta`), tier mapping for `claude-*` names,
  header passthrough; route test for auth via `x-api-key` and `Bearer`.

## Verification

1. Unit tests above green.
2. Manual against the deployed proxy: `ANTHROPIC_BASE_URL=https://student-accounts.jtlapp.net/proxy
   ANTHROPIC_AUTH_TOKEN=llmp_... ANTHROPIC_API_KEY= ANTHROPIC_MODEL=league-large claude -p "say hi"`
   → a reply; the student's usage increments.
3. `curl -X POST .../proxy/v1/messages -H "x-api-key: llmp_..." -H "anthropic-version: 2023-06-01"
   -d '{"model":"league-small","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'` → Anthropic-shaped JSON.
4. With `LLM_PROXY_ANTHROPIC_ENABLED=false` the route returns 404 and the
   client hides the Claude tab.

## Dependencies

- Deployed OpenRouter proxy (`deploy-current-master-and-fix-deployment-docs.md`).
- Budgets issue for dollar cost of these requests (tokens are recorded
  regardless).
