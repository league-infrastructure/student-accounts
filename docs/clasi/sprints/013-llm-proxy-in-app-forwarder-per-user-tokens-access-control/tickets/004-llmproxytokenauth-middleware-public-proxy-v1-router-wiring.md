---
id: '004'
title: llmProxyTokenAuth middleware + public /proxy/v1 router wiring
status: done
use-cases:
- SUC-013-003
- SUC-013-005
depends-on:
- '002'
- '003'
github-issue: ''
todo: ''
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# llmProxyTokenAuth middleware + public /proxy/v1 router wiring

## Description

Wire the bearer-auth middleware and the public proxy route group.

Files to create:

- `server/src/middleware/llmProxyTokenAuth.ts`:
  - Reads `Authorization: Bearer <token>` from the request.
  - If absent or malformed → 401 `{error: 'Missing bearer token'}`.
  - Calls `req.services.llmProxyTokens.validate(token)`:
    - `LlmProxyTokenUnauthorizedError` → 401 with the message.
    - `LlmProxyTokenQuotaExceededError` → 429 with the message.
    - Anything else → 500 (fall-through to error handler).
  - On success, attach `res.locals.llmProxyToken = row` and call
    `next()`.

- `server/src/routes/llm-proxy.ts` (`llmProxyRouter`):
  - `GET /health` → unauthenticated `{ok: true, endpoint:
    '/proxy/v1/messages'}` 200.
  - `POST /messages` → `llmProxyTokenAuth` then a handler that:
    1. If `LLM_PROXY_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` is
       unset → 503 `{error: 'LLM proxy not configured on the
       server'}`.
    2. Calls `req.services.llmProxyForwarder.forwardMessages(req,
       res, { onUsage })`, where `onUsage(input, output)` invokes
       `req.services.llmProxyTokens.recordUsage(token.id, input,
       output)` without awaiting.
  - Reject any other method with 405.

App wiring (`server/src/app.ts`):

- Import `llmProxyRouter` and mount at `/proxy/v1` (NOT `/api`).
  Mount *before* the generic 404/error handler.
- Add a body-parsing opt-out: the forwarder handler does not need
  Express's JSON body-parser re-serializing the body; use
  `express.json({ limit: '10mb' })` at the router level ONLY for
  `POST /messages` — this keeps the existing default limit for the
  rest of the app (Claude requests can be large due to base64
  images).

Session behaviour: the public `/proxy/v1` routes must NOT engage
the session store. Place the router mount BEFORE any middleware
that requires a session, or explicitly `router.use((req, _res,
next) => next())` to isolate it. Note: `app.ts` places session
middleware globally; verify the router still works because
`llmProxyTokenAuth` does not read the session. This is fine, but
document that session cookies received on `/proxy/v1` are ignored.

## Acceptance Criteria

- [x] `llmProxyTokenAuth` middleware responds 401 for missing /
      invalid / revoked / expired tokens, 429 for quota exhausted,
      and attaches the token row on success.
- [x] `GET /proxy/v1/health` returns 200 with the documented body
      and requires no auth.
- [x] `POST /proxy/v1/messages` with a valid bearer forwards to
      Anthropic via `LlmProxyForwarderService`.
- [x] `POST /proxy/v1/messages` with no key configured returns
      503.
- [x] `POST /proxy/v1/messages` with an invalid token returns 401.
- [x] `POST /proxy/v1/messages` with a quota-exhausted token
      returns 429.
- [x] Non-`POST` methods on `/messages` return 405.
- [x] New tests pass.
- [x] `npm run test:server` and `npm run test:client` pass relative
      to the pre-existing drift.

## Testing

- **Existing tests to run**: `npm run test:server`.
- **New tests to write**:
  - `tests/server/llm-proxy.routes.test.ts`:
    - 401 with no Authorization header.
    - 401 with `Bearer garbage`.
    - 200 on `/health`.
    - 503 when API key is absent (temporarily delete env).
    - Happy-path POST: mocked forwarder returns 200; assert the
      forwarder was called with the request body.
    - 429 when token is over quota (set `tokens_used =
      token_limit` in fixture).
    - 401 when token is expired.
    - 401 when token is revoked.
- **Verification command**: `npm run test:server`.
