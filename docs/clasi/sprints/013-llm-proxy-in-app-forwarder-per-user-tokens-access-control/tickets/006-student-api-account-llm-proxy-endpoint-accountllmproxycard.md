---
id: "006"
title: "Student /api/account/llm-proxy endpoint + AccountLlmProxyCard"
status: todo
use-cases: ["SUC-013-004"]
depends-on: ["002"]
github-issue: ""
todo: ""
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Student /api/account/llm-proxy endpoint + AccountLlmProxyCard

## Description

Add the student-facing self-service endpoint and UI card.

Server: extend `server/src/routes/account.ts`.

- `GET /api/account/llm-proxy` — `requireAuth` +
  `requireRole('student')`. Calls
  `req.services.llmProxyTokens.getActiveForUser(userId)`. Builds:
  - Endpoint URL: construct from the request:
    `const scheme = req.secure ? 'https' : 'http';` +
    `${scheme}://${req.get('host')}/proxy/v1`. (Trust-proxy is
    already set at app start so `req.secure` is correct in
    production behind Caddy.)
  - If no active token: `{enabled: false, endpoint}`. Still
    returning `endpoint` so the UI can render the setup snippet
    greyed-out.
  - If active token: `{enabled: true, endpoint, tokensUsed,
    tokenLimit, expiresAt, grantedAt}`. Never include plaintext or
    hash.

Client: `client/src/pages/account/AccountLlmProxyCard.tsx` — a new
card rendered inside `Account.tsx` after the external-accounts
section.

- Uses `useQuery(['account-llm-proxy'], ...)` to fetch the endpoint.
- When `enabled: false`:
  - Title: "LLM Proxy"
  - Body: "Not enabled. Ask an admin to grant LLM proxy access for
    your account."
  - No token shown; no setup snippet shown.
- When `enabled: true`:
  - Quota bar: `tokensUsed / tokenLimit` with remaining count.
  - Expiry: "Expires 2026-05-21" (human format).
  - Endpoint URL with Copy button.
  - "Using your token" panel with setup snippets (the token itself
    is NOT surfaced here — a tooltip / help block explains the
    student received their token from the admin at grant time, and
    if lost, should request a new grant). Snippets:

    ```bash
    # Claude Code
    export ANTHROPIC_BASE_URL="{endpoint URL}"
    export ANTHROPIC_API_KEY="llmp_…"   # token given to you by your admin
    claude

    # curl
    curl -X POST "{endpoint URL}/messages" \
      -H "authorization: Bearer llmp_…" \
      -H "content-type: application/json" \
      -d '{"model":"claude-3-5-haiku-latest","max_tokens":128, \
           "messages":[{"role":"user","content":"hi"}]}'
    ```

Integration in `Account.tsx`: add the card in a way that does not
disturb the other sections' layout. Import + render it below the
existing "Services" section.

## Acceptance Criteria

- [ ] `GET /api/account/llm-proxy` returns 401 unauthenticated,
      403 for non-students, 200 for students.
- [ ] Disabled shape: `{enabled: false, endpoint}`.
- [ ] Enabled shape: `{enabled: true, endpoint, tokensUsed,
      tokenLimit, expiresAt, grantedAt}`; no plaintext, no hash.
- [ ] `AccountLlmProxyCard.tsx` renders both states correctly.
- [ ] `Account.tsx` renders the new card.
- [ ] New server + client tests pass.
- [ ] `npm run test:server` and `npm run test:client` pass relative
      to pre-existing drift.

## Testing

- **Existing tests to run**: `npm run test:server`,
  `npm run test:client`.
- **New tests to write**:
  - `tests/server/account-llm-proxy.routes.test.ts`:
    - 401 unauthenticated.
    - 403 for staff/admin roles.
    - 200 for student with no active token → `{enabled: false,
      endpoint}`.
    - 200 for student with active token → enabled shape, no
      plaintext.
  - `tests/client/AccountLlmProxyCard.test.tsx`:
    - Renders "Not enabled" in the disabled state.
    - Renders endpoint + quota bar + expiry in the enabled state.
- **Verification command**: `npm run test:server && npm run test:client`.
