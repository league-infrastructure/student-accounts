---
status: draft
sprint: '001'
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 001 Use Cases

These sprint use cases describe new or changed user-visible and system behaviours
introduced by switching the LLM proxy to OpenRouter with League model tiers.

---

## SUC-001: Student Connects an OpenAI-Compatible Client to the League Proxy

Parent: UC-API-Access (Runtime flow from LLMProxy.md §API Access)

- **Actor**: Student
- **Preconditions**:
  - Student has a valid LlmProxyToken (bearer token).
  - Student has an OpenAI-compatible LLM client (e.g. Continue, openai Python SDK,
    curl with OpenAI format).
  - Proxy server has `OPENROUTER_API_KEY` configured.
- **Main Flow**:
  1. Student sets `OPENAI_BASE_URL` to `<proxy-origin>/proxy/v1` and
     `OPENAI_API_KEY` to their bearer token in their client configuration.
  2. Student selects model `league-medium` (or `league-large` / `league-small`).
  3. Client sends `POST <proxy-origin>/proxy/v1/chat/completions` with
     `Authorization: Bearer <token>` and an OpenAI Chat Completions JSON body.
  4. Proxy validates the token, maps the model tier to the configured DeepSeek slug,
     injects `stream_options: { include_usage: true }` if streaming, and forwards
     to OpenRouter.
  5. OpenRouter returns the response (streaming or non-streaming).
  6. Proxy pipes the response back to the client; usage is recorded against the token.
- **Postconditions**:
  - Student receives a valid OpenAI-format chat completion response.
  - Token usage counters are updated.
- **Acceptance Criteria**:
  - [ ] `POST /proxy/v1/chat/completions` with a valid bearer token and model
        `league-medium` returns a 200 with OpenAI-format JSON.
  - [ ] The same endpoint works with `stream: true` and returns SSE chunks.
  - [ ] `POST /proxy/v1/messages` returns 404.

---

## SUC-002: Model Tier Resolution — League Names Map to Config-Driven Slugs

Parent: UC-API-Access

- **Actor**: System (proxy forwarder)
- **Preconditions**:
  - Request has arrived at `POST /proxy/v1/chat/completions` with a model string.
  - Config keys `LLM_PROXY_MODEL_LARGE`, `LLM_PROXY_MODEL_MEDIUM`,
    `LLM_PROXY_MODEL_SMALL` are set (defaulting to DeepSeek slugs).
- **Main Flow**:
  1. Forwarder reads the `model` field from the request body.
  2. Model string is matched against known patterns:
     - `league-large`, `large`, or `opus` → `LLM_PROXY_MODEL_LARGE`
     - `league-medium`, `medium`, or `sonnet` → `LLM_PROXY_MODEL_MEDIUM`
     - `league-small`, `small`, or `haiku` → `LLM_PROXY_MODEL_SMALL`
     - Unknown or absent → `LLM_PROXY_MODEL_MEDIUM` (cost-control default)
  3. The resolved slug replaces the model field before forwarding to OpenRouter.
- **Postconditions**:
  - Every forwarded request carries a known, operator-controlled model slug.
  - Unknown model strings are silently defaulted to medium (no 4xx to the student).
- **Acceptance Criteria**:
  - [ ] `league-large` / `large` / `opus` all resolve to `LLM_PROXY_MODEL_LARGE`.
  - [ ] `league-medium` / `medium` / `sonnet` all resolve to `LLM_PROXY_MODEL_MEDIUM`.
  - [ ] `league-small` / `small` / `haiku` all resolve to `LLM_PROXY_MODEL_SMALL`.
  - [ ] An unrecognised string resolves to `LLM_PROXY_MODEL_MEDIUM`.
  - [ ] Missing model field resolves to `LLM_PROXY_MODEL_MEDIUM`.

---

## SUC-003: Student Views OpenAI-Format Setup Instructions

Parent: (student self-service, /llm-proxy page)

- **Actor**: Student
- **Preconditions**:
  - Student is signed in and has an active LlmProxyToken.
  - Student visits the /llm-proxy page or sees the account card.
- **Main Flow**:
  1. Page renders setup instructions showing:
     - `OPENAI_BASE_URL="<proxy-origin>/proxy/v1"`
     - `OPENAI_API_KEY="<token>"`
     - Recommended model names: `league-medium`, `league-small`, `league-large`.
  2. A curl example targeting `POST <proxy-origin>/proxy/v1/chat/completions`
     with `Authorization: Bearer <token>` is shown.
  3. No Claude Code, `ANTHROPIC_BASE_URL`, or Anthropic-specific variables appear.
- **Postconditions**:
  - Student can copy working configuration for an OpenAI-compatible client.
- **Acceptance Criteria**:
  - [ ] Setup snippet references `OPENAI_BASE_URL` and `OPENAI_API_KEY`.
  - [ ] curl example targets `/proxy/v1/chat/completions` with `Authorization: Bearer`.
  - [ ] No reference to `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, Claude Code, or
        model slugs like `claude-sonnet-4-6`.
  - [ ] League model tier names (`league-medium`, etc.) appear in the copy.

---

## SUC-004: Operator Configures OpenRouter Key and Model Tiers via Config Keys

Parent: (operator/admin configuration flow)

- **Actor**: Operator (admin)
- **Preconditions**:
  - Application is deployed; operator has access to env vars or the admin Config panel.
- **Main Flow**:
  1. Operator sets `OPENROUTER_API_KEY` to their OpenRouter API key.
  2. Operator optionally overrides `LLM_PROXY_BASE_URL` (defaults to
     `https://openrouter.ai/api/v1/chat/completions`).
  3. Operator optionally overrides `LLM_PROXY_MODEL_LARGE`,
     `LLM_PROXY_MODEL_MEDIUM`, `LLM_PROXY_MODEL_SMALL` to change which
     model slugs back each tier.
  4. Application uses these values on the next request; no code change required.
- **Postconditions**:
  - Proxy forwards to the correct upstream URL with the correct model slugs.
  - Operator can swap providers or models without a deployment.
- **Acceptance Criteria**:
  - [ ] `OPENROUTER_API_KEY` is listed in CONFIG_KEYS as a secret.
  - [ ] `LLM_PROXY_BASE_URL`, `LLM_PROXY_MODEL_LARGE`, `LLM_PROXY_MODEL_MEDIUM`,
        `LLM_PROXY_MODEL_SMALL` are listed in CONFIG_KEYS as non-secret.
  - [ ] All five new keys appear in `secrets.env.example` or `public.env`
        templates with comments explaining their purpose and defaults.
  - [ ] `ANTHROPIC_API_KEY` in CONFIG_KEYS is relabelled to make clear it serves
        the Admin API only, not the proxy.

---

## SUC-005: Merge Eval Uses OpenRouter Instead of Anthropic SDK

Parent: UC-018 (Merge Suggestion Generated by Haiku on User Creation)

- **Actor**: System (triggered on User creation)
- **Preconditions**:
  - `OPENROUTER_API_KEY` is set.
  - `LLM_PROXY_MODEL_SMALL` is set (defaults to `deepseek/deepseek-v3.2`).
- **Main Flow**:
  1. On User creation, `HaikuClientImpl.evaluate()` is called.
  2. Client sends a `POST` to OpenRouter's chat completions endpoint using
     `Authorization: Bearer <OPENROUTER_API_KEY>` and model `LLM_PROXY_MODEL_SMALL`.
  3. Response is parsed for the JSON `{ confidence, rationale }` payload.
  4. The rest of the merge suggestion flow (threshold, MergeSuggestion record,
     AuditEvent) is unchanged.
- **Postconditions**:
  - Merge suggestions are evaluated without the `@anthropic-ai/sdk` dependency.
  - `ANTHROPIC_API_KEY` is no longer required for merge eval.
- **Acceptance Criteria**:
  - [ ] `haiku.client.ts` does not import `@anthropic-ai/sdk`.
  - [ ] `HaikuClientImpl` sends requests to OpenRouter using `fetch`.
  - [ ] Model used is read from `LLM_PROXY_MODEL_SMALL` env var
        (defaulting to `deepseek/deepseek-v3.2`).
  - [ ] Existing `HaikuClient` interface and error types (`HaikuApiError`,
        `HaikuParseError`) are preserved so callers require no changes.
