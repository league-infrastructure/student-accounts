---
status: pending
---

# LLM proxy: budgets in dollars with a monthly reset

## Context

Stakeholder requirement (2026-10-17): each student may spend **$5–10 per
month** on AI, settable per student by staff. The proxy's quota today is a
lifetime **token count** (`LlmProxyToken.token_limit` / `tokens_used`,
default 1,000,000, checked in `llm-proxy-token.service.ts:326`): it is not
money (a `league-large` token costs far more than a `league-small` one), it
never resets, and when it runs out an admin has to re-grant. All students
share one `OPENROUTER_API_KEY`, so the only account-wide backstop is the
prepaid OpenRouter balance.

Considered and rejected for now: per-student real OpenRouter keys minted
through OpenRouter's management API (`limit` + `limit_reset: monthly`,
OpenRouter enforces it). It would work and a reference implementation
exists (`infrastructure/llm-keys`), but students would then bypass the
proxy and its model tiers, and we would be running two credential systems.
Keep the proxy; make its budget real.

## Scope

- Track spend in USD per token, from what OpenRouter reports.
- Monthly budget per user with automatic reset; default from config.
- Enforce before forwarding; students and admins see dollars.
- Keep the token-count fields working during transition.

## Design

**Cost per request.** OpenRouter returns the request's cost when asked:
add `"usage": {"include": true}` to the forwarded body (works for
streaming and non-streaming; the final usage object carries `cost` in USD
credits). In `llm-proxy-forwarder.service.ts`, extend `onUsage(input,
output)` to `onUsage({inputTokens, outputTokens, costUsd, model})`. If
`cost` is absent (provider quirk), fall back to a per-tier price table in
config (`LLM_PROXY_PRICE_LARGE/MEDIUM/SMALL` as USD per 1M tokens, in and
out) so accounting never silently records zero.

**Schema** (`LlmProxyToken`): add `budget_usd Decimal` (monthly cap),
`spent_usd Decimal @default(0)` (this period), `period_start DateTime`,
`spent_usd_total Decimal @default(0)`. Keep `token_limit`/`tokens_used`
for now; the quota check becomes `spent_usd >= budget_usd` **or** the old
token check if `budget_usd` is null (so existing tokens keep behaving
until backfilled).

**Reset.** On every authenticated request, if `period_start` is before
the first of the current UTC month, set `spent_usd = 0, period_start =
<first of month>` before the check (no cron needed, and matches
OpenRouter's "midnight UTC" semantics). A nightly job is not required.

**Request log.** Add `LlmProxyRequest {token_id, ts, model_requested,
model_sent, input_tokens, output_tokens, cost_usd, status}` so "what did
this student spend it on" is answerable and the per-period sum can be
recomputed. Keep 90 days (prune in the daily backup job).

**Defaults and admin.** `LLM_PROXY_DEFAULT_BUDGET_USD` (default `5`) in
`CONFIG_KEYS`; grants take `budgetUsd` (the token limit becomes optional);
bulk grant by cohort/group takes it too; `PATCH /api/admin/llm-proxy/tokens/:id`
`{budgetUsd}` to change a budget without re-granting. `GET /api/account/llm-proxy`,
the admin status endpoint and the fleet endpoint return `budgetUsd`,
`spentUsd`, `periodResetsAt`. The admin card/page work is in
`admin-llm-usage-visibility-and-dollar-limits.md`, the student page in
`student-llm-proxy-page-with-setup-examples.md`; this issue supplies the
fields and a minimal rendering so nothing shows stale token-only copy.

**Both protocols.** The cost hook applies to `chat/completions` and, once
`anthropic-compatible-proxy-endpoint-for-claude-code.md` lands, to
`/messages`; the forwarder's `onUsage` carries `{inputTokens,
outputTokens, costUsd, modelSent}` for either.

**Backstop.** Document in the admin UI the OpenRouter credit balance as
the account-wide cap; optionally `LLM_PROXY_MONTHLY_CAP_USD` for the whole
proxy (sum of `spent_usd`), returning 503 with a clear message when hit.

## Files

- `server/src/services/llm-proxy-forwarder.service.ts` (usage.include,
  cost parsing, fallback prices), `llm-proxy-token.service.ts`
  (`assertUsable` → budget check + period reset, `recordUsage` → dollars),
  `repositories/llm-proxy-token.repository.ts`
- `server/prisma/schema.prisma` + migration (new columns, `LlmProxyRequest`)
- `server/src/services/config.ts`, `routes/admin/llm-proxy.ts`,
  `routes/admin/users.ts` (grant params), `bulk-llm-proxy.service.ts`,
  `routes/account.ts`, `routes/fleet.ts`
- Client: `AccountLlmProxyCard.tsx`, `LlmProxy.tsx`, `LlmProxyUsage.tsx`,
  `admin/UserLlmProxyCard.tsx`, bulk grant dialog
- Tests: forwarder tests for `usage.include` injection and cost parsing
  (streaming final chunk and non-streaming); token service tests for
  reset-on-first-request-of-month, enforcement at the cap, fallback
  pricing; route tests for the admin budget PATCH.

## Verification

1. Grant a token with `budgetUsd: 0.01`; two small requests → second (or
   third) returns 429 with "monthly budget"; `LlmProxyRequest` has rows
   with non-zero `cost_usd` matching OpenRouter's activity page within
   rounding.
2. Set `period_start` to last month in the DB; next request resets
   `spent_usd` to 0 and succeeds.
3. Existing token with `budget_usd = null` still enforces the token count.
4. Account page shows dollars; fleet endpoint returns them; the laptop app
   displays them.

## Dependencies

- None hard. Lands best after the fleet endpoint so both show the same
  fields. The current master (OpenRouter proxy) must be deployed first
  (`deploy-current-master-and-fix-deployment-docs.md`).
