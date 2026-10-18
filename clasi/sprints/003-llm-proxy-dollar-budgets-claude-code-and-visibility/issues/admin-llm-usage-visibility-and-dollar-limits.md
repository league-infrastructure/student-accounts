---
status: in-progress
sprint: '003'
tickets:
- 003-005
---

# Admin: see a student's LLM key and usage, set their dollar limit

## Context

An instructor looking at a student needs to see whether they have an LLM
proxy key, what it is, how much they have used this month, and to raise or
lower their monthly dollar limit (default $5). Today the admin card
(`client/src/pages/admin/UserLlmProxyCard.tsx`) shows grant/revoke and a
token count. There is no dollar figure (that is
`llm-proxy-dollar-budgets-with-monthly-reset.md`), no way to see the key,
no link to the full picture.

## Scope

- Admin card shows: key (masked, reveal, copy), this month's spend vs
  limit in dollars, resets-on date, request count, status
  (active/expired/revoked), the dollar limit as an editable field.
- A button to a full admin page for that student's LLM proxy with the same
  setup examples the student sees (`student-llm-proxy-page-with-setup-examples.md`),
  so an instructor can walk a student through setup from their own screen.
- A link to OpenRouter's activity page for the shared account, labelled as
  account-wide (the proxy uses one upstream key; per-student detail lives
  in our own request log).
- Default limit for new grants comes from config (`LLM_PROXY_DEFAULT_BUDGET_USD`,
  $5).

## Design

**API.** Extend `GET /api/admin/users/:id/llm-proxy` (or the existing
token-status endpoint in `routes/admin/llm-proxy.ts`) to return `{token,
budgetUsd, spentUsd, periodResetsAt, tokenLimit, tokensUsed,
requestCount, expiresAt, grantedAt, revokedAt, status}`; add
`PATCH /api/admin/llm-proxy/tokens/:id` `{budgetUsd}` (from the budgets
issue) and reuse grant/revoke. Audit `llm_proxy_budget_changed`.

**Card** (`UserLlmProxyCard.tsx`): compact; dollar meter first; limit
field with Save; key row with masked value, Show, Copy; "Open LLM page"
button → `/admin/users/:id/llm-proxy`; "OpenRouter activity" external
link (`https://openrouter.ai/activity`).

**Full page** (`client/src/pages/admin/UserLlmProxyPage.tsx`, route
`/admin/users/:id/llm-proxy`): header with the student's name and the
same figures; then the shared `LlmProxySetupExamples` component (student
issue) rendered with **this student's** token and the proxy endpoint, so
the admin can copy a ready-to-paste snippet for them; a "Recent requests"
table from the request log (time, model, tokens, cost) once the budgets
issue lands.

## Files

- `server/src/routes/admin/llm-proxy.ts`, `routes/admin/users.ts`
- `client/src/pages/admin/UserLlmProxyCard.tsx`,
  `client/src/pages/admin/UserLlmProxyPage.tsx` (new), router entry,
  `UserDetailPanel.tsx`
- Shared: `client/src/components/LlmProxySetupExamples.tsx` (from the
  student issue)
- Tests: route test for the extended status payload and budget PATCH;
  client tests for the card (limit save, reveal/copy) and page render.

## Verification

1. Admin opens a student with a token: sees `$0.42 of $5.00`, resets date,
   masked key; Show reveals it; Copy copies it.
2. Changes the limit to 10 → saved, audit event, student's page shows
   `of $10.00`.
3. "Open LLM page" shows the examples with the student's token filled in.
4. Student without a token: card offers Grant with the default $5.

## Dependencies

- `llm-proxy-dollar-budgets-with-monthly-reset.md` for the dollar fields
  (the card can land first showing tokens, then switch).
- `student-llm-proxy-page-with-setup-examples.md` for the shared examples
  component.
