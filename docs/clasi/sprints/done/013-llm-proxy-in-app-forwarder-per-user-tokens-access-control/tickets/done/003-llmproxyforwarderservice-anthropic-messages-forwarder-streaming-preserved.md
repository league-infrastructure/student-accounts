---
id: '003'
title: LlmProxyForwarderService (Anthropic Messages forwarder, streaming preserved)
status: done
use-cases:
- SUC-013-003
depends-on: []
github-issue: ''
todo: ''
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# LlmProxyForwarderService (Anthropic Messages forwarder, streaming preserved)

## Description

Create `server/src/services/llm-proxy-forwarder.service.ts`:
`LlmProxyForwarderService`.

Responsibilities:

- Hold the server-side Anthropic API key (read once in the
  constructor; reads
  `process.env.LLM_PROXY_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? ''`).
- Expose `async forwardMessages(req: Request, res: Response, opts: {
  onUsage: (input: number, output: number) => void }): Promise<void>`.
- Forward the request to `https://api.anthropic.com/v1/messages`
  using `fetch`. Construct headers:
  - `x-api-key`: configured server key.
  - `anthropic-version`: `2023-06-01`.
  - `content-type`: `application/json`.
  - Pass through any `anthropic-beta` header the client sent (used
    by newer Claude Code builds for experimental features).
- Forward the body verbatim (from `req.body`, JSON-stringified).
- Detect streaming: if the JSON body has `"stream": true`, wire the
  upstream response's `body` (a WHATWG ReadableStream) directly into
  `res` so bytes flow as they arrive. Set `content-type:
  text/event-stream; charset=utf-8` and `cache-control: no-cache,
  no-transform` on the response. Use a
  `TransformStream`/async-iterator pass-through that also parses
  SSE events looking for `event: message_delta` / `event:
  message_start` — accumulating `usage.input_tokens` from
  `message_start` (if present) and `usage.output_tokens` from
  `message_delta` (cumulative, so keep the last value seen). After
  the upstream stream ends, call `opts.onUsage(input, output)`.
- For non-streaming: read the JSON body, mirror the status code,
  copy the `content-type` header, send the body. Extract
  `body.usage.input_tokens` and `body.usage.output_tokens` and call
  `opts.onUsage(...)` before returning. If the upstream returns a
  non-2xx status, still call `onUsage(0, 0)` so the request counts
  but zero tokens are billed.
- If the constructor key is empty, every forward call throws
  `LlmProxyNotConfiguredError` (new class in this file, statusCode
  503). The route layer translates to 503.

Streaming implementation notes:

- Use `response.body` (a `ReadableStream`) and the
  `getReader()` API; pipe chunks into `res.write(chunk)` and call
  `res.end()` when done.
- Maintain a buffer of unconsumed bytes; split on `\n\n` to get
  complete SSE events; parse `data: {...}` JSON payloads to extract
  `usage` when present. Non-JSON `data:` lines (e.g. `[DONE]`) are
  ignored.
- Client disconnects: listen on `res.on('close', ...)` and abort the
  upstream fetch via `AbortController` so we do not keep consuming
  Anthropic tokens for a client that's gone.

Service registry wiring:

- Add `readonly llmProxyForwarder: LlmProxyForwarderService` to
  `ServiceRegistry`; construct with no arguments.
- Typed on `req.services`.

## Acceptance Criteria

- [x] `LlmProxyForwarderService` exists with the
      `forwardMessages(req, res, { onUsage })` method.
- [x] Non-streaming forward mirrors status and JSON body;
      `onUsage` receives the usage numbers from
      `body.usage.{input_tokens,output_tokens}`.
- [x] Streaming forward sets `content-type: text/event-stream`,
      writes bytes as they arrive (no buffering of the full
      upstream body), and calls `onUsage` after the stream ends.
- [x] Accumulated `usage.output_tokens` from `message_delta` events
      is captured.
- [x] Client `res.on('close')` aborts the upstream request.
- [x] Missing/empty API key throws `LlmProxyNotConfiguredError`
      (statusCode 503).
- [x] Service registry exposes `llmProxyForwarder` and
      `req.services.llmProxyForwarder` is typed.
- [x] New tests pass.
- [x] `npm run test:server` and `npm run test:client` pass relative
      to the pre-existing drift.

## Testing

- **Existing tests to run**: `npm run test:server`.
- **New tests to write**:
  - `tests/server/services/llm-proxy-forwarder.service.test.ts`:
    - Non-streaming: mock `global.fetch` to return a JSON body
      with `usage`; assert response body, status, and
      `onUsage` call.
    - Streaming: mock `fetch` to return a ReadableStream that
      emits `message_start` then `message_delta` SSE frames;
      assert `res.write` is called progressively and `onUsage`
      is called with accumulated output tokens.
    - Missing key: construct with empty key; assert
      `LlmProxyNotConfiguredError` is thrown on forward.
    - Client disconnect: fire `res.emit('close')`; assert upstream
      abort is triggered (AbortController.signal.aborted === true).
- **Verification command**: `npm run test:server`.
