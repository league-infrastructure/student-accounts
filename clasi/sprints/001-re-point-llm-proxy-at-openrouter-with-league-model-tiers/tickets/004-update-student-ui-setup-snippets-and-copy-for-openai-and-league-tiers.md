---
id: '004'
title: Update student UI setup snippets and copy for OpenAI and League tiers
status: done
use-cases:
- SUC-003
depends-on:
- '003'
github-issue: ''
issue: ''
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Update student UI setup snippets and copy for OpenAI and League tiers

## Description

Replace the Claude Code / Anthropic-specific setup instructions in the student
UI with OpenAI-compatible instructions referencing League model tiers. This
ticket depends on ticket 003 because the snippets reference the endpoint path
`/proxy/v1/chat/completions` (now live).

### `client/src/components/LlmProxyUsage.tsx`

Replace both snippet generator functions:

**New setup snippet** (was `claudeSnippet`, rename to `openAiSnippet`):
```
# OpenAI-compatible client setup
export OPENAI_BASE_URL="${endpoint}/v1"
export OPENAI_API_KEY="${token}"
# League model tiers (choose one):
#   league-large   — most capable
#   league-medium  — balanced (recommended)
#   league-small   — fast and lightweight
```

**New curl snippet** (update `curlSnippet`):
```
# curl — use league-medium, league-large, or league-small
curl -X POST "${endpoint}/v1/chat/completions" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d '{"model":"league-medium","messages":[{"role":"user","content":"hi"}]}'
```

Remove the `<details>` / `<summary>` collapse for the curl block — both
snippets should be equally visible (two flat `CodeBlock` components). The
section heading above them (rendered by the parent, if any) can read
"Connect your AI client".

Update component JSDoc and any inline comments to remove references to
Claude Code, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, Sonnet, and Haiku.

### `client/src/pages/LlmProxy.tsx` — copy sweep

Search for and update any rendered text strings that mention:
- "Claude Code" → refer to "an OpenAI-compatible client (e.g. Continue)"
- "Anthropic" (in user-facing copy, not import paths) → remove or replace
  with provider-neutral phrasing
- "claude-sonnet-4-6", "claude-haiku-*" model slugs → remove; direct
  students to use the League tier names

Do not change the page's data-fetching logic, query keys, or component
structure.

### `client/src/pages/account/AccountLlmProxyCard.tsx` — copy sweep

Same sweep as LlmProxy.tsx. Update any display strings that reference
Claude Code, Anthropic, or specific Claude model slugs.

## Acceptance Criteria

- [x] `LlmProxyUsage.tsx` setup snippet references `OPENAI_BASE_URL` and
      `OPENAI_API_KEY` (not `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY`).
- [x] curl example targets `${endpoint}/v1/chat/completions` with
      `Authorization: Bearer`.
- [x] Snippet mentions `league-medium`, `league-large`, `league-small`.
- [x] No rendered text in `LlmProxy.tsx` or `AccountLlmProxyCard.tsx` contains
      "Claude Code", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY",
      "claude-sonnet-4-6", or "claude-haiku" visible to students.
- [x] All existing frontend tests pass (if any test these components).
- [ ] Manual review: visit /llm-proxy while signed in; setup snippet is correct
      and copy-pasteable.

## Implementation Plan

### Approach

String replacements and snippet rewrites. No data model or API changes.
Read the three files first before editing.

### Files to Modify

1. `client/src/components/LlmProxyUsage.tsx` — rewrite both snippet functions
   and update CodeBlock usage.
2. `client/src/pages/LlmProxy.tsx` — copy sweep of rendered JSX strings.
3. `client/src/pages/account/AccountLlmProxyCard.tsx` — copy sweep of rendered
   JSX strings.

### Testing Plan

- Run `npm test` in `client/` if a test suite exists.
- Manual verification: sign in as a student in the dev environment, navigate
  to /llm-proxy, confirm the setup snippet is correct and the curl example
  works against the local server.

### Documentation Updates

The updated UI copy is the user-facing documentation for this feature.
