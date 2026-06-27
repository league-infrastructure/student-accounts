---
status: done
tickets:
- '001'
- '002'
- '003'
- '004'
- '005'
---

# Plan: Re-point the LLM proxy at OpenRouter (OpenAI interface), with League model tiers

## Context

The student-accounts app runs a metered LLM proxy: each student gets a bearer token with a
token quota, points a coding tool at `https://student-accounts.jtlapp.net/proxy`, and the
server forwards their requests to an upstream LLM with a server-held key, metering token
usage per student.

Today that upstream is **Anthropic** and the proxy speaks the **Anthropic Messages** format
(it was built for Claude Code). We are **going all-in on OpenRouter** and **dropping Claude
Code** in favor of an **OpenAI-compatible** client (Continue or similar). So the proxy is
rewritten to speak the **OpenAI Chat Completions** interface end-to-end and forward to
OpenRouter's `POST /api/v1/chat/completions`. OpenRouter's OpenAI endpoint supports all
providers (including **DeepSeek**), so no Anthropic⇄OpenAI translation is needed — it stays a
clean passthrough, just in OpenAI format.

We also introduce three **abstracted, non-committal model tiers** — **League large / medium /
small** — so we never publicly name the underlying model and can re-point a tier via config.
Initial backing models are **DeepSeek** (per stakeholder): large = DeepSeek V4 Pro, with
similar DeepSeek models for medium/small.

## Scope

- **Rewrite** the student proxy forwarder to OpenRouter's OpenAI Chat Completions endpoint.
- **Switch** the internal merge-similarity eval (haiku.client.ts) to OpenRouter/DeepSeek too.
- **Update** student setup UI to OpenAI-style config (no more Claude Code / `ANTHROPIC_*`).
- **Out of scope / flagged:** [anthropic-admin.client.ts](server/src/services/anthropic/anthropic-admin.client.ts) provisions Claude Team org/seats via the Anthropic **Admin API** — a separate feature with no OpenRouter equivalent. Left untouched here; if you want to fully retire Anthropic, that feature needs its own plan.

## Design

### 1. Config (register in [config.ts](server/src/services/config.ts) `CONFIG_KEYS`)

| Key | Where | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | secrets.env (SOPS) | already present in repo `.env`; primary key. Alias `LLM_PROXY_API_KEY`. |
| `LLM_PROXY_BASE_URL` | public.env | `https://openrouter.ai/api/v1/chat/completions` |
| `LLM_PROXY_MODEL_LARGE` | public.env | `deepseek/deepseek-v4-pro` |
| `LLM_PROXY_MODEL_MEDIUM` | public.env | `deepseek/deepseek-v4-flash` |
| `LLM_PROXY_MODEL_SMALL` | public.env | `deepseek/deepseek-v3.2` |

Model slugs are non-secret → public.env; the key is secret → SOPS-encrypted secrets.env.
The public alias (League X) is decoupled from the slug, so the underlying model can change —
even to a non-DeepSeek provider — without anything students see changing. (Medium/small slugs
are my pick of "similar" DeepSeek models; verify against `GET /api/v1/models` at impl time.)

### 2. Forwarder rewrite — [llm-proxy-forwarder.service.ts](server/src/services/llm-proxy-forwarder.service.ts)
This is the core change. Keep the streaming/abort/onUsage structure; swap the protocol:
- **Upstream:** `LLM_PROXY_BASE_URL` (OpenRouter chat/completions) instead of `api.anthropic.com/v1/messages`.
- **Auth:** `Authorization: Bearer <OPENROUTER_API_KEY>`. Drop `x-api-key`, `anthropic-version`, `anthropic-beta`. Optionally add OpenRouter attribution headers `HTTP-Referer` (site URL) and `X-Title` ("JTL Student Accounts").
- **Key resolution:** `resolveLlmProxyApiKey()` → `OPENROUTER_API_KEY ?? LLM_PROXY_API_KEY`. Drop the `sk-ant-admin` guard (Anthropic-specific); keep the placeholder guard.
- **Model gate — rewrite `mapModel()`** to the three configurable tiers: `league-large|large|opus → LARGE`, `league-medium|medium|sonnet → MEDIUM`, `league-small|small|haiku → SMALL`, unknown/missing → MEDIUM. This keeps the existing cost-control gate (students can't select arbitrary/expensive models).
- **Streaming usage:** OpenAI streams only include usage if requested — when `body.stream === true`, inject `stream_options: { include_usage: true }`. Parse usage from the OpenAI shape: streaming → the final chunk's `usage` (`prompt_tokens`, `completion_tokens`); non-streaming → response `usage.prompt_tokens` / `usage.completion_tokens`. The existing `parseSseEvents` helper already handles `data:` lines and `[DONE]`; only the per-event extraction logic changes (read `payload.usage` instead of Anthropic `message_start`/`message_delta`). The `onUsage(inputTokens, outputTokens)` callback and all per-student quota metering ([llm-proxy-token.service.ts](server/src/services/llm-proxy-token.service.ts)) are unchanged.

### 3. Route + self-doc
- [routes/llm-proxy.ts](server/src/routes/llm-proxy.ts): replace `POST /messages` with `POST /chat/completions` (mounted at `/proxy/v1`, so the public path is `/proxy/v1/chat/completions`). Keep `/health`. Optional: add `GET /models` returning the three league tiers so OpenAI clients that list models work.
- [app.ts](server/src/app.ts): update the `GET /proxy` self-doc JSON to advertise `chat/completions` (drop the Anthropic fields). Surface the base URL students use as `<scheme>://<host>/proxy/v1` (OpenAI SDKs append `/chat/completions`).
- Auth middleware [llmProxyTokenAuth.ts](server/src/middleware/llmProxyTokenAuth.ts) already validates `Authorization: Bearer <token>` — matches OpenAI clients, no change. CORS header list in [llm-proxy.ts](server/src/routes/llm-proxy.ts) can drop the `anthropic-*` / `x-api-key` entries.

### 4. Student setup UI — [LlmProxyUsage.tsx](client/src/components/LlmProxyUsage.tsx)
Replace the Claude Code + Anthropic-curl snippets with **OpenAI-compatible** setup:
- Generic env-var block (works for most OpenAI tools): `OPENAI_BASE_URL="<endpoint>/v1"`, `OPENAI_API_KEY="<token>"`, model `league-medium` (default) / `league-small` (fast) / `league-large`.
- A `curl` example to `POST <endpoint>/v1/chat/completions` with `Authorization: Bearer <token>` and `{"model":"league-medium","messages":[...]}`.
- (Optional) a short Continue config snippet (`apiBase`, `apiKey`, `model`, `provider: openai`) as a concrete example.
Sweep the client for other "Claude Code"/"Anthropic" copy on the `/llm-proxy` page and account card and reword to provider-neutral League tiers.

### 5. Merge eval — [haiku.client.ts](server/src/services/merge/haiku.client.ts)
Switch from `@anthropic-ai/sdk` to an OpenAI-format call to OpenRouter (`OPENAI` SDK pointed at `https://openrouter.ai/api/v1`, or a plain fetch to chat/completions) using the `LLM_PROXY_MODEL_SMALL` slug. Contained change; same in→out classification, parse from OpenAI response shape.

### 6. Secrets/config templates + tests
- Document the new keys in [config/dev/secrets.env.example](config/dev/secrets.env.example), [config/prod/secrets.env.example](config/prod/secrets.env.example) and the matching public.env files; note `ANTHROPIC_API_KEY` is now only for the Admin client.
- Rewrite [llm-proxy-forwarder.service.test.ts](tests/server/services/llm-proxy-forwarder.service.test.ts) for the OpenAI path: chat/completions URL, Bearer auth, three-tier `mapModel`, `stream_options.include_usage` injection, and usage parsing from `prompt_tokens`/`completion_tokens` (streaming + non-streaming).

## Files to change
- [server/src/services/llm-proxy-forwarder.service.ts](server/src/services/llm-proxy-forwarder.service.ts) — protocol rewrite (URL, auth, mapModel, usage parsing)
- [server/src/routes/llm-proxy.ts](server/src/routes/llm-proxy.ts) — `chat/completions` route, CORS
- [server/src/app.ts](server/src/app.ts) — `/proxy` self-doc
- [server/src/services/config.ts](server/src/services/config.ts) — register OpenRouter keys + model slugs
- [server/src/services/merge/haiku.client.ts](server/src/services/merge/haiku.client.ts) — OpenRouter/DeepSeek
- [client/src/components/LlmProxyUsage.tsx](client/src/components/LlmProxyUsage.tsx) + `/llm-proxy` page / account card copy
- config templates (dev/prod secrets.env.example + public.env)
- [tests/server/services/llm-proxy-forwarder.service.test.ts](tests/server/services/llm-proxy-forwarder.service.test.ts)

## Verification
1. **Unit:** forwarder tests green — `mapModel` resolves all three league aliases to the DeepSeek slugs; Bearer header set; URL = OpenRouter chat/completions; `stream_options.include_usage` injected; usage read from `prompt_tokens`/`completion_tokens`.
2. **Local e2e** (`npm run dev` in server/, real `OPENROUTER_API_KEY` in dev config, grant a token):
   - `curl -X POST <proxy>/v1/chat/completions -H "Authorization: Bearer <token>" -d '{"model":"league-small","messages":[{"role":"user","content":"hi"}]}'` → 200, OpenAI-shaped response, and `tokens_used` increments (check admin token-status endpoint).
   - Repeat with `"stream": true` → SSE chunks pass through; quota still increments from the final usage chunk.
   - Point the chosen OpenAI client (Continue, with `apiBase=<proxy>/v1`, `apiKey=<token>`, model `league-medium`) at the proxy and confirm a working completion.
   - Hit the quota cap → 429; revoked/expired token → 401/403 (unchanged behavior).
3. **Merge eval:** trigger a merge-similarity evaluation and confirm it runs through OpenRouter/DeepSeek and returns a sane result.

## Process note
Repo uses the CLASI SE process (currently `uninitialized`). This is a focused, well-scoped
change — recommend executing via OOP mode (skip full sprint ceremony) unless you want a
tracked sprint.
