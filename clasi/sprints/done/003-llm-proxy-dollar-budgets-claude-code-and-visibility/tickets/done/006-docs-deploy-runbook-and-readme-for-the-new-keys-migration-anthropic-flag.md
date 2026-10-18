---
id: '006'
title: 'Docs: deploy runbook and README for the new keys, migration, Anthropic flag'
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '005'
github-issue: ''
issue: llm-proxy-dollar-budgets-with-monthly-reset.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Docs: deploy runbook and README for the new keys, migration, Anthropic flag

## Description

Documentation only. Bring `docs/deploy.md` and `README.md` up to date with this sprint: new config keys, the migration, the Anthropic endpoint flag, how to backfill budgets, and the Claude Code setup line for the deploy smoke test. Then run the sprint's final verification.

## Acceptance Criteria

- [x] `docs/deploy.md`: new env keys (`LLM_PROXY_DEFAULT_BUDGET_USD`, `LLM_PROXY_PRICE_*`, `LLM_PROXY_ANTHROPIC_BASE_URL`, `LLM_PROXY_ANTHROPIC_ENABLED` now default true and how to turn it off), the new migration name(s), the post-deploy step `POST /api/admin/llm-proxy/backfill-budgets` (or the admin button if one exists), smoke checks: `curl -X POST .../proxy/v1/messages -H "x-api-key: llmp_..." -H "anthropic-version: 2023-06-01" -d '{"model":"league-small","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'` and the `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` Claude Code one-liner; note that `spent_usd` increments and `LlmProxyRequest` rows appear.
- [x] `README.md`: an "LLM proxy" section describing both protocols, tiers, dollar budgets with monthly reset, where students and admins see things (`/llm-proxy`, admin card/page), and the request-log retention (90 days).
- [x] `server/prisma/schema.prisma` comment on `LlmProxyToken` mentions budgets and the request log; `GET /proxy` self-doc already updated in ticket 003 (verify).
- [x] Final verification for the sprint recorded in this ticket's body: `npm run test:server` summary (counts; only baseline files red), `npm run test:client` summary, both `tsc --noEmit` clean, lint error count unchanged (12).

## Final verification

Run 2026-10-18 on branch `sprint/003-llm-proxy-dollar-budgets-claude-code-and-visibility`
after the documentation edits (schema comment, `docs/deploy.md`, `README.md`),
each command alone, from the repo root unless noted.

| Check | Result |
|-------|--------|
| `npm run test:server` | 138 files: **5 failed**, 133 passed. 2311 tests: **39 failed**, 2272 passed. Duration 176.7 s. |
| `npm run test:client` | 34 files, 496 tests, all passed. Duration 18.0 s. |
| `cd server && npx tsc --noEmit` | clean (exit 0) |
| `cd client && npx tsc --noEmit` | clean (exit 0) |
| `cd server && npm run lint` | 14 problems: **12 errors** (pre-existing, unchanged), 2 warnings |
| `cd server && npx prisma validate` | valid |

Red server files, all baseline:

- `tests/server/services/workspace-provisioning.service.test.ts` (20/20 failed)
- `tests/server/services/claude-provisioning.service.test.ts` (14/14 failed)
- `tests/server/schema-t005.test.ts` (3/16 failed)
- `tests/server/services/auth/google-admin-directory.client.test.ts` (1/43 failed)
- `tests/server/auth-user.test.ts` (1/16 failed: `POST /api/auth/logout > clears
  the session`, `Error: read ECONNRESET`). This is the documented single-test
  ECONNRESET flake under full-suite load, not a baseline file; re-run in
  isolation (`npx vitest run ../tests/server/auth-user.test.ts`) it is 16/16
  green.

`tests/server/auth-flows.integration.test.ts`, on the baseline list, passed in
this run (13/13). Nothing outside the baseline set plus the one flake is red.

`GET /proxy` self-doc (ticket 003) verified in `server/src/app.ts`: it lists
`protocols: ["openai","anthropic"]`, `anthropicBaseUrl`, `messages` and the
Anthropic env block when `LLM_PROXY_ANTHROPIC_ENABLED` is `true`, and
`["openai"]` only otherwise.

## Testing

- **Existing tests to run**: both full suites (as the sprint's final check).
- **New tests to write**: none.
- **Verification command**: `npm run test:server && npm run test:client && (cd server && npx tsc --noEmit) && (cd client && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests). `npm run test:server` from the repo root (~4 min; not concurrently with other suites). `cd server && npx tsc --noEmit` clean. `cd server && npm run lint` has 12 pre-existing errors; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Baseline failures (may stay red, nothing else may go red): `tests/server/auth-flows.integration.test.ts`, `schema-t005.test.ts`, `services/claude-provisioning.service.test.ts`, `services/workspace-provisioning.service.test.ts`, `services/auth/google-admin-directory.client.test.ts`; plus rare single-test 404/ECONNRESET flakes under full-suite load (re-run the file in isolation before concluding).
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read `req.services`. Audit through `AuditService`.
- Prisma schema changes: edit `server/prisma/schema.prisma`, `cd server && npx prisma migrate dev --name <slug>` (dev DB from `.env`), `npx prisma generate` (`server/src/generated/` is gitignored), and `npx prisma db push --url file:./data/test.db` for the local test DB (not migration-managed).
- Commit on the sprint branch when the ticket's tests pass, message starting with `[003-NNN]`, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not bump the version.
- The issue files this sprint serves are in `clasi/sprints/003-llm-proxy-dollar-budgets-claude-code-and-visibility/issues/`.
