---
id: '001'
title: Register OpenRouter config keys and update env templates
status: done
use-cases:
- SUC-004
depends-on: []
github-issue: ''
issue: ''
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Register OpenRouter config keys and update env templates

## Description

Add five new config keys to `server/src/services/config.ts` CONFIG_KEYS so the
application tracks and validates them:

- `OPENROUTER_API_KEY` (secret, requiresRestart: false) — Bearer key for OpenRouter
- `LLM_PROXY_BASE_URL` (non-secret, requiresRestart: false) — upstream URL override
- `LLM_PROXY_MODEL_LARGE` (non-secret, requiresRestart: false)
- `LLM_PROXY_MODEL_MEDIUM` (non-secret, requiresRestart: false)
- `LLM_PROXY_MODEL_SMALL` (non-secret, requiresRestart: false)

Also relabel the existing `ANTHROPIC_API_KEY` entry from `'Claude API Key'` to
`'Claude Admin API Key'` to make clear it serves `anthropic-admin.client.ts` only,
not the LLM proxy.

Document all new keys in the four env template files:
- `config/dev/secrets.env.example` — add `OPENROUTER_API_KEY` with comment
  explaining it is the bearer key for the LLM proxy. Note `ANTHROPIC_API_KEY` is
  now for the Admin API only.
- `config/prod/secrets.env.example` — same.
- `config/dev/public.env` — add commented-out `LLM_PROXY_BASE_URL`,
  `LLM_PROXY_MODEL_LARGE`, `LLM_PROXY_MODEL_MEDIUM`, `LLM_PROXY_MODEL_SMALL`
  with defaults and descriptions.
- `config/prod/public.env` — same.

No runtime behaviour changes in this ticket; this is purely registration and
documentation. All subsequent tickets depend on these config keys being registered.

## Acceptance Criteria

- [x] `CONFIG_KEYS` in `server/src/services/config.ts` includes all five new keys
      with correct `isSecret` and `requiresRestart` values.
- [x] `ANTHROPIC_API_KEY` entry label is updated to `'Claude Admin API Key'`.
- [x] `config/dev/secrets.env.example` includes `OPENROUTER_API_KEY` with an
      explanatory comment and updated note for `ANTHROPIC_API_KEY`.
- [x] `config/prod/secrets.env.example` includes the same additions.
- [x] `config/dev/public.env` includes commented-out model tier and base URL vars
      with defaults (`deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`,
      `deepseek/deepseek-v3.2`) and the OpenRouter base URL as the default for
      `LLM_PROXY_BASE_URL`.
- [x] `config/prod/public.env` includes the same.
- [x] `getConfig('OPENROUTER_API_KEY')` returns the env var value when set.

## Implementation Plan

### Approach

All changes are to configuration registration and documentation files only.
No service logic is changed in this ticket.

### Files to Modify

1. `server/src/services/config.ts` — insert five new entries into CONFIG_KEYS
   array and update the ANTHROPIC_API_KEY label.
2. `config/dev/secrets.env.example` — add `OPENROUTER_API_KEY` block; update
   `ANTHROPIC_API_KEY` comment.
3. `config/prod/secrets.env.example` — same additions.
4. `config/dev/public.env` — add commented-out LLM_PROXY_* vars.
5. `config/prod/public.env` — same.

### Testing Plan

- No new unit tests required (config.ts is a pure data structure; the
  `getAllConfig()` / `getConfig()` functions require no new tests for key addition).
- Run existing test suite to confirm no regressions: `npm test` in `server/`.
- Manual verification: start the dev server; call `GET /api/admin/config` to confirm
  the five new keys appear in the response.

### Documentation Updates

The env template comments are the documentation for this feature.
