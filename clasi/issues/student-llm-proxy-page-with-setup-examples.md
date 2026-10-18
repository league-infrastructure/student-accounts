---
status: pending
---

# Student LLM proxy: tighter card, full page with setup examples for every tool

## Context

The student's Account page has an LLM proxy card
(`client/src/pages/account/AccountLlmProxyCard.tsx`) with the endpoint,
the token, a usage bar and setup snippets (`client/src/components/LlmProxyUsage.tsx`:
one Continue entry and a curl). Stakeholder (2026-10-17): the card should
be tight (status, usage, key, one button), and a full page should carry
multiple, current examples: Claude Code, curl, Continue, OpenCode, Hermes,
Python/OpenAI SDK, and anything else that needs special treatment. The
same examples must be reusable on the admin's view of a student
(`admin-llm-usage-visibility-and-dollar-limits.md`).

## Scope

- Card: usage (dollars once available, tokens until then), masked key
  with Copy, status, one button "Set up and details" → `/llm-proxy`.
  Remove the snippets from the card.
- `/llm-proxy` page: the key and endpoint, usage, and a tabbed or
  stacked set of examples, each with Copy.
- One shared component `LlmProxySetupExamples` that takes `{endpoint,
  token, models}` so the admin page renders the same thing for a chosen
  student.

## Design

**Examples** (each shows the student's real token and the proxy base URL;
model names are the League tiers):

| Tool | What is shown |
|---|---|
| Claude Code | `export ANTHROPIC_BASE_URL="<endpoint>"`, `export ANTHROPIC_AUTH_TOKEN="<token>"`, `export ANTHROPIC_API_KEY=""`, `export ANTHROPIC_MODEL="league-large"` (+ `ANTHROPIC_SMALL_FAST_MODEL="league-small"`), then `claude`. Requires the Anthropic-compatible endpoint (`anthropic-compatible-proxy-endpoint-for-claude-code.md`); until it ships, the tab says "coming soon" from a feature flag. |
| curl | `POST <endpoint>/v1/chat/completions` with `Authorization: Bearer` and a `league-medium` body; a second curl for `/v1/models`. |
| Continue (VS Code) | `~/.continue/config.yaml` `models:` entry: `provider: openai`, `apiBase: <endpoint>/v1`, `apiKey: <token>`, `model: league-medium`, `roles: [chat, edit, apply]`. |
| OpenCode | `~/.config/opencode/opencode.json` with a custom provider `league` (`npm: "@ai-sdk/openai-compatible"`, `options.baseURL: <endpoint>/v1`, `options.apiKey: <token>`, models `league-small/medium/large`) and `"model": "league/league-medium"`. |
| Hermes Agent | `~/.hermes/config.yaml` `model: {provider: custom, base_url: <endpoint>/v1, default: league-medium}` and `hermes config set OPENAI_API_KEY <token>` (verify the exact keys against Hermes docs at implementation). |
| Python (OpenAI SDK) | `OpenAI(base_url="<endpoint>/v1", api_key="<token>")` chat completion with `league-medium`. |
| Generic env | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and the three model names. |

Each example is a small template function in
`client/src/components/llm-examples/*.ts` returning text, rendered by
`LlmProxySetupExamples.tsx` with a Copy button and a one-line "how to
test it worked". The model tier list comes from `GET /proxy/v1/models`
so renames don't need a client change. Keep provider-neutral wording
(League tiers, not model vendors), as sprint 001 decided.

**Card** (`AccountLlmProxyCard.tsx`): one row of figures (`$x of $y this
month` or `n / m tokens` until the budgets issue), status, masked key +
Copy, button. If not enabled: "Not enabled. Ask an instructor." stays.

**Page** (`client/src/pages/LlmProxy.tsx`): header (key with Show/Copy,
endpoint with Copy, usage meter, reset date), then the examples. Reads
`GET /api/account/llm-proxy`.

## Files

- `client/src/components/LlmProxySetupExamples.tsx` (new),
  `client/src/components/llm-examples/{claude-code,curl,continue,opencode,hermes,python,env}.ts`
  (new), `client/src/components/LlmProxyUsage.tsx` (remove or reduce to
  a wrapper), `client/src/pages/account/AccountLlmProxyCard.tsx`,
  `client/src/pages/LlmProxy.tsx`, `client/src/pages/Account.tsx`
  (Features section copy)
- `server/src/routes/account.ts` (`GET /api/account/llm-proxy` adds
  `models` and `anthropicEnabled`)
- Tests: client tests for the card (no snippets, button present) and the
  page (every example contains the token and endpoint); snapshot of
  each template.

## Verification

1. Account page card: figures, key, one button; no code blocks.
2. `/llm-proxy`: seven examples, each Copy puts the exact text with the
   real token on the clipboard; Claude Code tab hidden/"coming soon" when
   `anthropicEnabled` is false.
3. Paste the Continue example into a real `~/.continue/config.yaml` and
   get a completion against the deployed proxy; same for the curl.
4. Admin page renders the same component for a chosen student.

## Dependencies

- Soft: budgets issue (dollar figures), Anthropic endpoint issue (Claude
  tab live). Lands independently.
