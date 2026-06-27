---
id: '001'
title: Re-point LLM proxy at OpenRouter with League model tiers
status: done
branch: sprint/001-re-point-llm-proxy-at-openrouter-with-league-model-tiers
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
issues: []
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 001: Re-point LLM proxy at OpenRouter with League model tiers

## Goals

Switch the student LLM proxy from Anthropic's Messages API to OpenRouter's
OpenAI-compatible Chat Completions API. Introduce three abstracted, config-driven
model tiers — League large / medium / small — backed initially by DeepSeek slugs.
Update the student setup UI to reflect the new OpenAI-compatible interface.
Switch the internal merge-eval client (haiku.client.ts) from the Anthropic SDK
to an OpenRouter call.

## Problem

The proxy currently targets `https://api.anthropic.com/v1/messages` using the
Anthropic Messages API protocol (Anthropic-specific headers, SSE event shapes,
model naming). The League is moving from Claude Code to OpenAI-compatible tooling
(Continue, standard OpenAI clients), which speaks OpenAI Chat Completions format.
Additionally, hardcoded Claude model slugs expose the League to model churn and
prevent the operator from switching providers without a code change.

## Solution

1. Rewrite `LlmProxyForwarderService` to call `POST openrouter.ai/api/v1/chat/completions`
   using `Authorization: Bearer <OPENROUTER_API_KEY>` and OpenAI-format request/response
   bodies. The service becomes a clean passthrough — no protocol translation, because
   the clients now speak OpenAI natively.
2. Register five new config keys: `OPENROUTER_API_KEY`, `LLM_PROXY_BASE_URL`,
   `LLM_PROXY_MODEL_LARGE`, `LLM_PROXY_MODEL_MEDIUM`, `LLM_PROXY_MODEL_SMALL`.
3. Replace the `POST /proxy/v1/messages` route with `POST /proxy/v1/chat/completions`.
   Add an optional `GET /proxy/v1/models` listing the three League tiers.
4. Update the `GET /proxy` self-doc and CORS headers.
5. Rewrite the student setup snippets in `LlmProxyUsage.tsx` for OpenAI clients.
   Sweep copy on the /llm-proxy page and account card.
6. Replace the Anthropic SDK call in `haiku.client.ts` with an OpenRouter fetch
   using `LLM_PROXY_MODEL_SMALL`.
7. Document new config keys in secrets.env.example and public.env templates.
8. Rewrite the forwarder test suite for the OpenAI path.

## Success Criteria

- `POST /proxy/v1/chat/completions` with a valid bearer token forwards to OpenRouter
  and returns the response, both streaming and non-streaming.
- Model `league-large` resolves to `LLM_PROXY_MODEL_LARGE`; `league-medium` and
  `league-small` resolve similarly; unrecognised strings default to medium.
- `POST /proxy/v1/messages` no longer exists; returns 404.
- Student UI shows OpenAI-format setup instructions referencing `league-medium` etc.
- `haiku.client.ts` no longer imports `@anthropic-ai/sdk`; uses `fetch` to OpenRouter.
- All forwarder unit tests pass for the new path.
- `ANTHROPIC_API_KEY` is documented as "Admin API only, not used by proxy".

## Scope

### In Scope

- `server/src/services/llm-proxy-forwarder.service.ts` — full rewrite
- `server/src/services/config.ts` — add five new CONFIG_KEYS entries
- `server/src/routes/llm-proxy.ts` — route rename + CORS header update + /models endpoint
- `server/src/app.ts` — update GET /proxy self-doc
- `client/src/components/LlmProxyUsage.tsx` — replace Claude Code / Anthropic curl snippets
- `client/src/pages/LlmProxy.tsx` — sweep Anthropic / Claude Code copy
- `client/src/pages/account/AccountLlmProxyCard.tsx` — sweep copy
- `server/src/services/merge/haiku.client.ts` — switch from Anthropic SDK to OpenRouter fetch
- `config/dev/secrets.env.example`, `config/prod/secrets.env.example` — document new keys
- `config/dev/public.env`, `config/prod/public.env` — document LLM_PROXY_BASE_URL if non-secret
- `tests/server/services/llm-proxy-forwarder.service.test.ts` — rewrite for OpenAI path

### Out of Scope

- `server/src/services/anthropic/anthropic-admin.client.ts` — Anthropic Admin API for
  Claude Team seat provisioning; no OpenRouter equivalent; untouched.
- Token quota / per-student metering in `llm-proxy-token.service.ts` — unchanged.
- Auth middleware `llmProxyTokenAuth.ts` — already speaks `Authorization: Bearer`; no change.
- Any changes to the student registration or passphrase flows.
- Switching away from OpenRouter to another provider.

## Test Strategy

- Unit tests for `LlmProxyForwarderService` (rewrite `llm-proxy-forwarder.service.test.ts`):
  - Verify upstream URL is `LLM_PROXY_BASE_URL` (defaulting to OpenRouter).
  - Verify `Authorization: Bearer` header and absence of Anthropic headers.
  - Verify `mapModel` maps `league-large`, `league-medium`, `league-small`, aliases,
    and unknown strings.
  - Verify `stream_options: { include_usage: true }` is injected when `stream: true`.
  - Verify usage extraction from `usage.prompt_tokens` / `usage.completion_tokens`
    in non-streaming path.
  - Verify streaming usage extracted from final chunk's `usage` field.
- Manual smoke test: configure `OPENROUTER_API_KEY` in dev env, hit
  `POST /proxy/v1/chat/completions` with a bearer token, verify response.

## Architecture Notes

See `architecture-update.md` in this sprint directory for full detail.

Key constraints:
- `parseSseEvents` helper is reused unchanged — it handles `data:` lines and `[DONE]`.
  Only the per-event payload extraction changes (OpenAI fields vs. Anthropic fields).
- `onUsage(inputTokens, outputTokens)` callback contract is unchanged, so
  `llm-proxy-token.service.ts` metering requires zero changes.
- The existing abort-on-close AbortController pattern is kept intact.
- `ANTHROPIC_API_KEY` env var remains registered in CONFIG_KEYS but is relabelled
  as "Claude Admin API Key" (serves `anthropic-admin.client.ts` only).

## GitHub Issues

(None yet — no linked GitHub issues for this sprint.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Register OpenRouter config keys and update env templates | — |
| 002 | Rewrite LlmProxyForwarderService for OpenRouter/OpenAI + rewrite forwarder tests | 001 |
| 003 | Update proxy route, CORS headers, self-doc, and add /models endpoint | 002 |
| 004 | Update student UI: setup snippets and copy sweep | 003 |
| 005 | Switch merge-eval haiku.client.ts to OpenRouter fetch | 001 |

Tickets execute serially in the order listed.
