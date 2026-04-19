---
id: "002"
title: "HaikuClient — Anthropic SDK wrapper for merge similarity evaluation"
status: todo
use-cases: [SUC-007-001]
depends-on: []
github-issue: ""
todo: ""
---

# HaikuClient — Anthropic SDK wrapper for merge similarity evaluation

## Description

Create `server/src/services/merge/haiku.client.ts`. This module wraps the
Anthropic SDK to evaluate whether two User records likely represent the same
person. It accepts two `UserSnapshot` objects, constructs a structured
comparison prompt requesting a JSON response with `confidence` and `rationale`,
calls the `claude-haiku-4-5` model, and parses the response.

Also install `@anthropic-ai/sdk` into `server/package.json`.

Use the `claude-api` skill guidance when implementing. The implementation should
use the Anthropic SDK's `messages.create()` API. Prompt caching is not required
for this sprint (candidate pool is small). Confirm the `ANTHROPIC_API_KEY` env
var name against `config/dev/secrets.env.example` before coding.

## Acceptance Criteria

- [ ] `@anthropic-ai/sdk` is added to `server/package.json` dependencies.
- [ ] `server/src/services/merge/haiku.client.ts` exists and exports `HaikuClient`.
- [ ] `HaikuClient` constructor accepts `apiKey: string`.
- [ ] `HaikuClient.evaluate(userA, userB)` returns `{ confidence: number, rationale: string }`.
- [ ] `confidence` is a float in the range `[0.0, 1.0]`.
- [ ] `HaikuApiError` is thrown when the Anthropic SDK throws or returns a non-2xx status.
- [ ] `HaikuParseError` is thrown when the response body cannot be parsed to
      `{ confidence, rationale }`.
- [ ] The comparison prompt includes both users' `display_name`, `primary_email`,
      `pike13_id` (if present), `cohort_name` (if present), `created_via`, `created_at`.
- [ ] Unit tests cover: successful evaluation, `HaikuApiError` path, `HaikuParseError` path
      (using mocked Anthropic SDK responses).

## Implementation Plan

### Approach

1. Run `npm install @anthropic-ai/sdk` in `server/`.
2. Create `server/src/services/merge/` directory and `haiku.client.ts`.
3. Define `UserSnapshot` interface and `HaikuSimilarityResult` interface.
4. Define `HaikuApiError` and `HaikuParseError` error classes.
5. Implement the prompt as a system message instructing Haiku to respond with
   JSON only: `{ "confidence": <float>, "rationale": "<string>" }`.
6. Call `client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 256, ... })`.
7. Parse the response `content[0].text` as JSON; validate shape.

### Files to Create/Modify

- `server/package.json` — add `@anthropic-ai/sdk`
- `server/src/services/merge/haiku.client.ts` — new
- `server/src/services/merge/index.ts` — re-export (optional)
- `tests/server/merge/haiku.client.test.ts` — unit tests with mocked SDK

### Testing Plan

- Mock `@anthropic-ai/sdk` in Jest config or use `jest.mock()` in test file.
- Test: returns `{ confidence, rationale }` for a valid mocked response.
- Test: throws `HaikuApiError` when SDK throws.
- Test: throws `HaikuParseError` when response text is not valid JSON.
- Test: throws `HaikuParseError` when response JSON is missing `confidence` field.

### Documentation Updates

Add `ANTHROPIC_API_KEY` note to `config/dev/secrets.env.example` if not already
present (confirm before adding).
