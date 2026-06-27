---
id: '005'
title: Switch merge-eval haiku.client.ts to OpenRouter fetch
status: done
use-cases:
- SUC-005
depends-on:
- '001'
github-issue: ''
issue: ''
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Switch merge-eval haiku.client.ts to OpenRouter fetch

## Description

Replace the `@anthropic-ai/sdk` call in `HaikuClientImpl` with a `fetch`-based
call to OpenRouter's chat completions endpoint. The `HaikuClient` interface,
`UserSnapshot` type, and both error classes (`HaikuApiError`, `HaikuParseError`)
must remain unchanged so all callers require no modifications.

This ticket depends on ticket 001 (config keys) because `HaikuClientImpl` will
read `OPENROUTER_API_KEY` and `LLM_PROXY_MODEL_SMALL` from env vars. It is
independent of tickets 002–004 and can execute in parallel after 001 completes;
however, in serial execution it runs last.

### Changes to `server/src/services/merge/haiku.client.ts`

1. **Remove** `import Anthropic from '@anthropic-ai/sdk'`.
2. **Remove** `private readonly anthropic: Anthropic` field.
3. **Update constructor**: Accept `apiKey: string` (same signature). Store as
   `private readonly apiKey: string`. The caller already passes
   `process.env.ANTHROPIC_API_KEY` — callers may need updating to pass
   `process.env.OPENROUTER_API_KEY` instead, but the constructor signature is
   unchanged.
4. **Update `HAIKU_MODEL` constant**: Read `LLM_PROXY_MODEL_SMALL` env var with
   default `'deepseek/deepseek-v3.2'`. Rename the constant to
   `MERGE_EVAL_MODEL` for clarity.
5. **Rewrite `evaluate()`**: Replace `this.anthropic.messages.create(...)` with
   a `fetch` POST to `https://openrouter.ai/api/v1/chat/completions` (or
   `process.env.LLM_PROXY_BASE_URL`). Request body is OpenAI Chat Completions
   format:
   ```json
   {
     "model": "<MERGE_EVAL_MODEL>",
     "max_tokens": 256,
     "messages": [
       {"role": "system", "content": "<buildSystemPrompt()>"},
       {"role": "user", "content": "<buildUserMessage(userA, userB)>"}
     ]
   }
   ```
   Auth header: `Authorization: Bearer <this.apiKey>`.
6. **Parse response**: Extract text from the first choice:
   `response.choices[0].message.content` (string). Pass this to the existing
   `parseResponse()` method unchanged.
7. **Error mapping**: Wrap fetch errors (network, non-2xx response) in
   `HaikuApiError`. Wrap JSON parse failures in `HaikuParseError` (already done
   by `parseResponse`).
8. **Update JSDoc and module-level comment** to remove `@anthropic-ai/sdk`
   references; describe the new fetch-based implementation and env var
   dependencies.

### Caller update

The place where `HaikuClientImpl` is constructed (likely `service.registry.ts`
or similar) passes `process.env.ANTHROPIC_API_KEY`. Update that construction
site to pass `process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? ''`
so the transition is graceful (old key as fallback during deploy).

### Follow-up (out of scope)

After verifying `@anthropic-ai/sdk` is unused elsewhere in the server package,
remove it from `server/package.json`. That is a separate commit, not part of
this ticket.

## Acceptance Criteria

- [x] `haiku.client.ts` has no `import Anthropic from '@anthropic-ai/sdk'` line.
- [x] `HaikuClientImpl.evaluate()` sends a `fetch` POST to OpenRouter (or
      `LLM_PROXY_BASE_URL`) with `Authorization: Bearer` and OpenAI Chat
      Completions format.
- [x] Model used is `process.env.LLM_PROXY_MODEL_SMALL ?? 'deepseek/deepseek-v3.2'`.
- [x] `HaikuClient` interface is unchanged.
- [x] `HaikuApiError` and `HaikuParseError` are unchanged and still thrown on
      the appropriate failure modes.
- [x] `UserSnapshot` and `HaikuSimilarityResult` types are unchanged.
- [x] Existing haiku client tests (if any) pass or are updated to mock `fetch`
      instead of the Anthropic SDK.
- [x] Full test suite passes: `npm test` in `server/` (25 non-Prisma tests pass;
      94 test files fail due to pre-existing Prisma ERR_DLOPEN_FAILED; no new failures).

## Implementation Plan

### Approach

In-place rewrite of `HaikuClientImpl`, keeping the `HaikuClient` interface and
all public types/errors intact. The response shape change (Anthropic
`content[0].text` → OpenAI `choices[0].message.content`) is the critical
transformation.

### Files to Modify

1. `server/src/services/merge/haiku.client.ts` — rewrite `HaikuClientImpl`.
2. Constructor call site (find with `grep -r 'HaikuClientImpl' server/src/`) —
   update to pass `OPENROUTER_API_KEY`.
3. `tests/server/services/merge/haiku.client.test.ts` (if exists) — update
   mocks from Anthropic SDK to `fetch`.

### Testing Plan

- Run existing haiku client tests if present.
- Run full suite: `npm test` in `server/`.
- Integration check: trigger a merge suggestion flow in the dev environment
  (create two similar users) and verify the suggestion is generated without
  errors in the log.

### Documentation Updates

Update module-level JSDoc in `haiku.client.ts` only. No external docs.
