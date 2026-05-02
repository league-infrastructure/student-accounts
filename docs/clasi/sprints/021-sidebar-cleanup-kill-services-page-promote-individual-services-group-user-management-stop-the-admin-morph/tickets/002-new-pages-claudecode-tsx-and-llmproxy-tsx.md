---
id: '002'
title: 'New pages: ClaudeCode.tsx and LlmProxy.tsx'
status: done
use-cases:
- SUC-002
- SUC-003
depends-on:
- '001'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# New pages: ClaudeCode.tsx and LlmProxy.tsx

## Description

Create two new standalone pages by extracting content from `Services.tsx`
(which will be deleted in ticket 004). Mount them under `AppLayout` in
`App.tsx`. Write page-level tests for each.

### ClaudeCode.tsx — `/claude-code`

Extract `ClaudeCodeSection` from `Services.tsx` into a new top-level page at
`client/src/pages/ClaudeCode.tsx`. The page:

- Fetches account data from `/api/account` (same `useQuery(['account'])` call).
- Reads the `claude` ExternalAccount from `data.externalAccounts`.
- Shows the onboarding steps (install, auth, verify) when `claudeAccount.status === 'active'`.
- Shows the pending message when `claudeAccount.status === 'pending'`.
- Shows an "access not available" message for other statuses.
- If no `claude` ExternalAccount, shows a brief "Claude Code is not enabled on
  your account" message (the sidebar item is already hidden, but a user could
  still reach the URL directly).

### LlmProxy.tsx — `/llm-proxy`

Extract `LlmProxySection` from `Services.tsx` into a new top-level page at
`client/src/pages/LlmProxy.tsx`. The page:

- Fetches LLM proxy status from `/api/account/llm-proxy` (same query as in
  `LlmProxySection`).
- Renders the full LLM Proxy card: endpoint, token, quota bar, usage snippet.
- Handles loading, error, and "not enabled" states same as the existing section.
- Uses `data-testid="account-llm-proxy-card"` on the root element (same as
  the existing `LlmProxySection` — tests depend on this attribute).

### App.tsx route additions

Add to the `AppLayout` route block (alongside `/account`, `/oauth-clients`):

```tsx
<Route path="/claude-code" element={<ClaudeCode />} />
<Route path="/llm-proxy" element={<LlmProxy />} />
```

## Acceptance Criteria

- [x] `client/src/pages/ClaudeCode.tsx` exists and renders `ClaudeCodeSection` content.
- [x] `client/src/pages/LlmProxy.tsx` exists and renders the LLM Proxy card content.
- [x] `/claude-code` route is registered in `App.tsx` under `AppLayout`.
- [x] `/llm-proxy` route is registered in `App.tsx` under `AppLayout`.
- [x] ClaudeCode page renders install/auth/verify steps for `active` claude account.
- [x] ClaudeCode page renders pending message for `pending` claude account.
- [x] ClaudeCode page shows a graceful "not enabled" state when no claude ExternalAccount.
- [x] LlmProxy page renders endpoint, token, and quota when `status.enabled === true`.
- [x] LlmProxy page renders "Not enabled" message when `status.enabled === false`.
- [x] `tests/client/pages/ClaudeCode.test.tsx` exists and passes.
- [x] `tests/client/pages/LlmProxy.test.tsx` exists and passes.
- [x] `npm run test:client` passes.

## Implementation Plan

### Approach

1. Copy `ClaudeCodeSection` function body from `Services.tsx` to a new default
   export in `ClaudeCode.tsx`. Wrap it in a page container with a title.
   Import `AccountData` from `Account.tsx`.
2. Copy `LlmProxySection`, `fetchLlmProxyStatus`, and the `LlmProxyStatus`
   interface from `Services.tsx` to `LlmProxy.tsx`. Make it the default export
   wrapped in a page container with a title.
3. Add the two routes to `App.tsx`.
4. Write `tests/client/pages/ClaudeCode.test.tsx`:
   - Mock `useQuery` or the fetch; test active, pending, and no-account states.
5. Write `tests/client/pages/LlmProxy.test.tsx`:
   - Mock `/api/account/llm-proxy`; test enabled (with data) and not-enabled states.

### Files to create

- `client/src/pages/ClaudeCode.tsx`
- `client/src/pages/LlmProxy.tsx`
- `tests/client/pages/ClaudeCode.test.tsx`
- `tests/client/pages/LlmProxy.test.tsx`

### Files to modify

- `client/src/App.tsx` — add two routes, add two imports

### Testing plan

- Run `npm run test:client` after each new test file to confirm they pass.
- Do not delete `Services.tsx` in this ticket — it is deleted in ticket 004
  after the Workspace block is also extracted (ticket 003).

### Documentation updates

None — architecture-update.md already documents these new modules.
