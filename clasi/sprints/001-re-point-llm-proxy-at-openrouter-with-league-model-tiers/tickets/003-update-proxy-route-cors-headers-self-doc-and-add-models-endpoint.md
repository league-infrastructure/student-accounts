---
id: "003"
title: "Update proxy route, CORS headers, self-doc, and add /models endpoint"
status: open
use-cases:
  - SUC-001
  - SUC-003
depends-on:
  - "002"
github-issue: ""
issue: ""
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Update proxy route, CORS headers, self-doc, and add /models endpoint

## Description

Update the Express router and application self-doc to expose the OpenAI-compatible
endpoints and drop the Anthropic-specific ones.

### `server/src/routes/llm-proxy.ts`

1. **Rename route**: Replace `POST /messages` with `POST /chat/completions`.
   Keep the same handler body — it calls `forwarder.forwardMessages(req, res, ...)`.
   Update the 405 catch-all from `/messages` to `/chat/completions`.

2. **CORS headers**: In the `llmProxyRouter.use(...)` middleware, update
   `Access-Control-Allow-Headers` to remove `anthropic-version`, `anthropic-beta`,
   and `x-api-key`. The new value should be `'Content-Type, Authorization'`.
   Update `Access-Control-Allow-Methods` to `'GET, POST, OPTIONS'` (unchanged
   value, but verify it covers the new GET /models route).

3. **`GET /health` response**: Update the `endpoint` field from
   `/proxy/v1/messages` to `/proxy/v1/chat/completions`.

4. **`GET /models`** (new): Add a `GET /models` route that returns a JSON object
   listing the three League model tiers and their resolved slugs:
   ```json
   {
     "object": "list",
     "data": [
       {"id": "league-large", "object": "model", "owned_by": "league"},
       {"id": "league-medium", "object": "model", "owned_by": "league"},
       {"id": "league-small", "object": "model", "owned_by": "league"}
     ]
   }
   ```
   This route is unauthenticated (like `/health`). It does not expose the
   backing DeepSeek slugs to clients.

### `server/src/app.ts`

Update the `GET /proxy` self-doc JSON response:
- Rename key `messages` → `chatCompletions` (value: `${base}/v1/chat/completions`).
- Remove `anthropicBaseUrl` key; add `openaiBaseUrl: ${base}/v1` so clients
  know the correct `OPENAI_BASE_URL` value.
- Update the `note` field to describe OpenAI-compatible usage instead of
  Anthropic SDK usage. New note:
  "Set OPENAI_BASE_URL to the openaiBaseUrl value; the OpenAI SDK appends
  /chat/completions. Requires a bearer token (Authorization: Bearer)."

## Acceptance Criteria

- [ ] `POST /proxy/v1/chat/completions` with valid bearer token returns 200.
- [ ] `POST /proxy/v1/messages` returns 404 (no longer registered).
- [ ] `GET /proxy/v1/health` returns `{ ok: true, endpoint: '/proxy/v1/chat/completions' }`.
- [ ] `GET /proxy/v1/models` returns the three-tier model list JSON (unauthenticated).
- [ ] CORS `Access-Control-Allow-Headers` does not include `anthropic-version`,
      `anthropic-beta`, or `x-api-key`.
- [ ] `GET /proxy` returns JSON with `openaiBaseUrl` key and `chatCompletions` key;
      no `anthropicBaseUrl` key.
- [ ] All existing route tests pass; full test suite passes.

## Implementation Plan

### Approach

Mechanical rename and addition in two files. The handler body for
`/chat/completions` is identical to the old `/messages` handler — only the path
string changes. The `/models` endpoint is a pure data return.

### Files to Modify

1. `server/src/routes/llm-proxy.ts` — rename route path, update CORS, update
   health response, add GET /models.
2. `server/src/app.ts` — update GET /proxy self-doc JSON.

### Testing Plan

- Run full test suite: `npm test` in `server/`.
- If route-level integration tests exist for the proxy, verify they reference
  `/chat/completions` after this ticket (or update them here).
- Manual verification: `curl -X POST <host>/proxy/v1/messages` should return 404.
  `curl <host>/proxy/v1/models` should return model list JSON.
  `curl <host>/proxy` should show updated self-doc.
