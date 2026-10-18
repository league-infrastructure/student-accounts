---
id: 008
title: Merge completeness, rule-based suggestions, manual merge, queue view
status: done
use-cases:
- SUC-005
depends-on:
- '003'
- '004'
github-issue: ''
issue: merge-handles-laptop-accounts-and-moves-everything.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Merge completeness, rule-based suggestions, manual merge, queue view

## Description

Make merging safe and useful for the duplicates the import creates. `MergeSuggestionService.approve()` currently moves only logins and external accounts; it must move everything. Add deterministic suggestions (same username / username = email local part / same display name), an admin manual merge, and a richer merge-queue view.

## Acceptance Criteria

- [x] `approve(suggestionId, survivorUserId, actorId)` in `server/src/services/merge-suggestion.service.ts`, one transaction, additionally: `UserGroup` moved (skip duplicates); `LlmProxyToken`: if survivor has no active token move the non-survivor's active one, else revoke the non-survivor's and add its `tokens_used`/`request_count` to the survivor's; `username`, `password_hash`, `laptop_password_hash` taken from the non-survivor when the survivor has none (else kept, dropped username recorded in the audit payload); `allows_*` flags OR-ed; `ExternalAccount` conflict on the partial unique index resolved by marking the non-survivor's row `removed`; OAuth consents/tokens/refresh tokens/authorization codes, provisioning requests, audit actor/target rows re-pointed; non-survivor `is_active=false`, `primary_email` parked as `merged:<id>:<email>`. After commit: `laptopAccounts.reconcile(survivor)` and, if the non-survivor had a username, lock its roster entry (`reconcile(nonSurvivor)` writes `!`). Audit `merge_approve` payload lists every moved/dropped item.
- [x] Rule-based suggestions in `server/src/services/auth/merge-scan.service.ts` (before the LLM pass, no OpenRouter call for hits): for the new user vs. every other active non-staff user, create a `MergeSuggestion` with `haiku_confidence: 1.0` and rationale `same username as email local part` / `same display name` when `username` equals the other's `primary_email` local part (case-insensitive) or normalised display names match (lowercase, collapse whitespace, ≥ 2 tokens). Dedupe via the existing canonical pair + P2002 handling. A backfill function `ruleScanAll(createdVia: 'laptop_import')` exposed as `POST /api/admin/merge-queue/rescan` (admin).
- [x] `POST /api/admin/users/:id/merge` body `{ otherUserId, survivorId }` (admin): 400 if survivor is neither, 409 if either is inactive; creates a pending suggestion with rationale `admin-initiated` and approves it in the same request; returns `{ ok: true, survivorId }`.
- [x] `GET /api/admin/merge-queue/:id` payload adds per user: `username`, `created_via`, `created_host` (from the `username` Login's `provider_payload`), active proxy token summary (`tokens_used`, `token_limit`), group names.
- [x] Client `MergeQueuePanel.tsx`: show those fields side by side; before confirming Approve, list what the non-survivor loses under the chosen survivor (e.g. "username bob is dropped; survivor keeps alice"). `UserDetailPanel.tsx`: "Merge with…" button with a user search (reuse the admin users list endpoint) → calls the manual endpoint.
- [x] Tests: extend `tests/server/services/merge-suggestion.service.test.ts` for every moved relation and both token cases and the parked email; rule scan tests with `fake-haiku.client.ts` asserting no LLM call for rule hits; `tests/server/routes/admin/merge.test.ts` for the manual endpoint and rescan; client test for the panel's new columns.

## Testing

- **Existing tests to run**: full server suite (merge, auth sign-in handler), `tests/client/` merge panel tests if present.
- **New tests to write**: as listed above.
- **Verification command**: `npm run test:server && npm run test:client && (cd server && npx tsc --noEmit) && (cd client && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
