---
status: pending
---

# Merge: handle imported laptop accounts, and move everything to the survivor

## Context

Importing the laptop roster (`laptop-accounts-sync-from-spaces-roster.md`)
creates users who very often already exist here under a Google or GitHub
login (same kid, different door). The merge queue is how an admin
reconciles them, so it has to work well for this case. Two problems with
`MergeSuggestionService.approve()` today
(`server/src/services/merge-suggestion.service.ts:191`): it moves only
`Login` and `ExternalAccount` rows and inherits the cohort; it does **not**
move `LlmProxyToken`, `UserGroup`, `username`/`password_hash`, OAuth rows
or the `allows_*` flags, so merging a laptop user into a Google user would
silently strip their laptop login credentials and proxy token. And
suggestions come only from the LLM scan (`merge-scan.service.ts`) run at
user creation; there is no deterministic rule and no way for an admin to
merge two arbitrary users.

## Scope

- `approve()` moves everything that belongs to the non-survivor.
- Deterministic merge suggestions for laptop imports.
- Admin can merge any two users from the detail panel.
- Merge queue UI shows what matters for this decision.

## Design

**approve() completeness**, still one transaction:

- `Login`, `ExternalAccount` (as now). For `ExternalAccount`, if both users
  have an active row of the same `type`, keep the survivor's and mark the
  other `removed` instead of tripping the partial unique index.
- `UserGroup`: move, skipping memberships the survivor already has.
- `LlmProxyToken`: if the survivor has no active token, move the
  non-survivor's active token (the student keeps the `llmp_` they already
  configured); otherwise revoke the non-survivor's. Carry
  `tokens_used`/`request_count` into the survivor's row when revoking, so
  spend is not forgotten.
- `username` + `password_hash`: if the survivor has none, take the
  non-survivor's (this is what keeps the laptop login working). If both
  have one, keep the survivor's and record the dropped username in the
  audit event; the laptop write-back then re-points the roster: the losing
  username's roster entry is locked (`!`) and the surviving one is written
  (see the management issue; call `LaptopAccountService.reconcile(user)`
  after the merge).
- `allows_*` flags: OR them. `is_active`: survivor stays active.
- `cohort_id`: as now.
- OAuth consents/tokens/refresh tokens, provisioning requests, audit
  events as actor/target: move `user_id` to the survivor.
- Non-survivor: `is_active = false`, and set `primary_email` aside
  (`merged:<id>:<email>`) so the unique index does not block re-import of
  the same real email later; record `merged_into` in a new nullable column
  or in the audit payload.

**Deterministic suggestions.** In `mergeScan` (or a new
`RuleBasedMergeScan` run before the LLM scan), create a `MergeSuggestion`
with `haiku_confidence: 1.0`, rationale `"same username"` /
`"username equals email local-part"` / `"same display name"` when:

- `username` equals another user's `username` (cannot happen, unique) or
  equals the local part of another user's `primary_email`;
- normalised `display_name` equal (case/whitespace-insensitive, ≥ 2
  tokens) and neither user is staff.

Run the rule scan for every user the laptop sync creates, and once as a
backfill job over existing laptop users.

**Admin manual merge.** `POST /api/admin/users/:id/merge` body
`{otherUserId, survivorId}`: inserts a `MergeSuggestion` (status pending,
rationale `"admin-initiated"`) and approves it in the same request, so the
audit trail is the same as a queued merge. Button "Merge with…" on
`UserDetailPanel.tsx` with a user search.

**Merge queue UI** (`MergeQueuePanel.tsx`): per side, show username,
laptop login (id, created_host), proxy token status (active / used), group
memberships; highlight the fields that would be dropped under the chosen
survivor before confirming.

## Files

- `server/src/services/merge-suggestion.service.ts` (`approve`),
  `server/src/services/auth/merge-scan.service.ts` (rule-based pass),
  `server/src/services/repositories/merge-suggestion.repository.ts`
- `server/src/routes/admin/merge-queue.ts` (detail payload),
  `server/src/routes/admin/users.ts` (manual merge)
- `server/prisma/schema.prisma` (+ migration) only if `merged_into` is a
  column
- `client/src/pages/admin/MergeQueuePanel.tsx`, `UserDetailPanel.tsx`
- Tests: extend `tests/server/services/merge-suggestion.service.test.ts`
  for every moved relation and both token cases; `tests/server/routes/admin/merge.test.ts`
  for the manual endpoint; rule-scan tests with `fake-haiku.client.ts`
  asserting Haiku is not called for rule hits.

## Verification

1. User A (Google, no username, active proxy token used 10k) + user B
   (laptop import, username `alice`, `$6$` hash, group G). Approve with
   survivor A → A has username `alice` and B's hash, membership in G, A's
   token kept and B's revoked with usage carried; B inactive, B's email
   parked; one audit event lists everything moved.
2. Same, survivor B → B keeps its token; A's logins now on B.
3. Rule scan: laptop user `alice` imported while `alice@gmail.com` exists →
   pending suggestion with confidence 1.0 and no OpenRouter call.
4. Manual merge endpoint: 400 when survivor is neither user; 409 when
   either user is inactive.
5. Merge queue shows the laptop and token columns.

## Dependencies

- Import issue (laptop Login, `$6$` hashes).
- Management issue for `LaptopAccountService.reconcile` (can land as a
  no-op hook first).
