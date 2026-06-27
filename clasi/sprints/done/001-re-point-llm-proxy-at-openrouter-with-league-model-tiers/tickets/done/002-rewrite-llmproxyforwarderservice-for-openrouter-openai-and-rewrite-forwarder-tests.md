---
id: '002'
title: Rewrite LlmProxyForwarderService for OpenRouter/OpenAI and rewrite forwarder
  tests
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '001'
github-issue: ''
issue: ''
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Rewrite LlmProxyForwarderService for OpenRouter/OpenAI and rewrite forwarder tests

## Description

Rewrite `server/src/services/llm-proxy-forwarder.service.ts` to forward to
OpenRouter using the OpenAI Chat Completions protocol, and rewrite
`tests/server/services/llm-proxy-forwarder.service.test.ts` for the new path.

This is the core service change. All other tickets (route, UI, merge eval) depend
on the service layer being correct.

### Forwarder changes

**URL**: Read from `process.env.LLM_PROXY_BASE_URL` with default
`https://openrouter.ai/api/v1/chat/completions`. Drop `ANTHROPIC_MESSAGES_URL`.

**Key resolution** (`resolveLlmProxyApiKey`):
- New precedence: `OPENROUTER_API_KEY ?? LLM_PROXY_API_KEY ?? ''`
- Drop the `sk-ant-admin` guard (not applicable to OpenRouter keys).
- Keep the placeholder guard (`'your-anthropic-api-key'` → empty string).

**Headers**:
- Send `Authorization: Bearer <key>` instead of `x-api-key`.
- Drop `anthropic-version`, `anthropic-beta`.
- Add optional `HTTP-Referer` (from `process.env.LLM_PROXY_HTTP_REFERER`) and
  `X-Title` (from `process.env.LLM_PROXY_X_TITLE`) for OpenRouter attribution.
- Do NOT pass the client's `Authorization` header upstream (already stripped).

**Model mapping** (`mapModel`):
- Three tiers resolved from env vars (with defaults):
  - `league-large` / `large` / `opus` → `process.env.LLM_PROXY_MODEL_LARGE ?? 'deepseek/deepseek-v4-pro'`
  - `league-medium` / `medium` / `sonnet` → `process.env.LLM_PROXY_MODEL_MEDIUM ?? 'deepseek/deepseek-v4-flash'`
  - `league-small` / `small` / `haiku` → `process.env.LLM_PROXY_MODEL_SMALL ?? 'deepseek/deepseek-v3.2'`
  - Unknown/absent → MEDIUM (cost-control default)
- Matching is case-insensitive on the full string (not substring).

**Streaming — `stream_options` injection**:
- When `body.stream === true`, inject `stream_options: { include_usage: true }`
  into the body before forwarding. This ensures OpenRouter returns token counts
  in the final SSE chunk.

**SSE usage extraction** (streaming path):
- Reuse `parseSseEvents` unchanged.
- In `onSseEvent`: extract usage from the final chunk where the OpenAI SSE payload
  has a `usage` object. Field names: `usage.prompt_tokens` (→ inputTokens) and
  `usage.completion_tokens` (→ outputTokens). These appear only on the last chunk
  when `stream_options.include_usage: true` is set.

**Non-streaming usage extraction**:
- Parse `response.usage.prompt_tokens` and `response.usage.completion_tokens`
  (instead of Anthropic's `usage.input_tokens` / `usage.output_tokens`).

**Unchanged**:
- Method signature: `forwardMessages(req, res, opts)` — keep for route compatibility
  (the route can rename later; keeping the same internal method name avoids a
  two-ticket refactor cascade). Internally it now calls OpenAI chat/completions.
- `onUsage(inputTokens, outputTokens)` callback — same contract.
- AbortController + `res.once('close', abortOnClose)` abort-on-close pattern.
- `isConfigured()` method.
- `LlmProxyNotConfiguredError` class.
- `parseSseEvents` function.
- 502 / early-abort error handling.
- Streaming pipe logic (bytes piped from reader to `res.write`).

**Log messages**: Update logger context strings to say `openrouter` instead of
`Anthropic`.

**Error message**: Update `LlmProxyNotConfiguredError` default message to reference
`OPENROUTER_API_KEY` instead of `ANTHROPIC_API_KEY`.

### Test rewrite

Replace `tests/server/services/llm-proxy-forwarder.service.test.ts` entirely.
The new test suite must cover:

1. `resolveLlmProxyApiKey()` — returns `OPENROUTER_API_KEY` when set; falls back to
   `LLM_PROXY_API_KEY`; rejects placeholder; accepts any non-placeholder non-empty
   string (no admin-key guard).
2. `mapModel()` — all tier aliases; unknown string → MEDIUM; missing → MEDIUM.
3. Non-streaming path — upstream URL is `LLM_PROXY_BASE_URL`; request has
   `Authorization: Bearer`; no `x-api-key` / `anthropic-version`; usage extracted
   from `prompt_tokens` / `completion_tokens`.
4. Streaming path — `stream_options.include_usage: true` injected in body;
   usage extracted from final SSE chunk `usage.prompt_tokens` /
   `usage.completion_tokens`; bytes piped to client.
5. Client disconnect — AbortController fires; response ends cleanly.
6. `isConfigured()` returns false when key empty, true when set.

## Acceptance Criteria

- [x] Upstream URL defaults to `https://openrouter.ai/api/v1/chat/completions`;
      overridable via `LLM_PROXY_BASE_URL` env var.
- [x] Outgoing request uses `Authorization: Bearer <OPENROUTER_API_KEY>`; no
      `x-api-key` or `anthropic-version` headers are sent.
- [x] `resolveLlmProxyApiKey()` returns `OPENROUTER_API_KEY` when set, falls back
      to `LLM_PROXY_API_KEY`, and returns empty string for placeholder value.
- [x] `mapModel('league-large')` returns `LLM_PROXY_MODEL_LARGE` (or its default).
- [x] `mapModel('league-medium')` returns `LLM_PROXY_MODEL_MEDIUM` (or its default).
- [x] `mapModel('league-small')` returns `LLM_PROXY_MODEL_SMALL` (or its default).
- [x] `mapModel('sonnet')` returns MEDIUM tier; `mapModel('opus')` returns LARGE;
      `mapModel('haiku')` returns SMALL.
- [x] Unknown or absent model string defaults to MEDIUM tier.
- [x] When `body.stream === true`, the forwarded body includes
      `stream_options: { include_usage: true }`.
- [x] Non-streaming usage reads `usage.prompt_tokens` / `usage.completion_tokens`.
- [x] Streaming usage reads from the final chunk's `usage` field.
- [x] `onUsage(inputTokens, outputTokens)` is called with correct counts in
      both streaming and non-streaming paths.
- [x] All new unit tests pass (`npm test` in `server/`).

## Implementation Plan

### Approach

Rewrite the service file in-place. Keep all public exports and method signatures
identical so the route (ticket 003) only needs to change the route path, not the
forwarder call.

### Files to Modify

1. `server/src/services/llm-proxy-forwarder.service.ts` — full rewrite per spec above.
2. `tests/server/services/llm-proxy-forwarder.service.test.ts` — full rewrite.

### Testing Plan

Run `npm test -- --testPathPattern=llm-proxy-forwarder` in `server/` to run only the
forwarder tests during development. Run the full suite before marking done.
