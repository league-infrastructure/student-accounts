---
id: "004"
title: "MergeSuggestionService — implement approve, reject, and defer methods"
status: done
use-cases: [SUC-007-003, SUC-007-004]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# MergeSuggestionService — implement approve, reject, and defer methods

## Description

Expand `server/src/services/merge-suggestion.service.ts` from the current
Sprint-001 stub to a full implementation. Add the following methods:

- `findQueueItems()` — returns all `MergeSuggestion` records with status in
  `[pending, deferred]`, including joined User A and User B data (names, emails).
  Ordered by `created_at` ascending.
- `findDetailById(id)` — returns a single suggestion with full User A and User B
  records including their Logins and ExternalAccounts.
- `approve(id, survivorId, actorId)` — executes the transactional merge:
  re-parents Logins, re-parents ExternalAccounts, cohort inheritance, deactivates
  non-survivor (`is_active=false`), updates suggestion status, writes AuditEvent.
  Throws a typed `MergeConflictError` if the suggestion is not in a pending/deferred
  state, or re-throws on transaction failure.
- `reject(id, actorId)` — sets `status=rejected`, `decided_by`, `decided_at`.
  Writes AuditEvent. Throws `MergeConflictError` if already decided.
- `defer(id)` — sets `status=deferred`. Does not set `decided_by` or `decided_at`.

## Acceptance Criteria

- [x] `findQueueItems()` returns pending + deferred suggestions with User summaries.
- [x] `findDetailById(id)` returns full User records with Logins and ExternalAccounts.
- [x] `approve()`: all Logins re-parented to survivor within a single Prisma
      `$transaction`.
- [x] `approve()`: all ExternalAccounts re-parented to survivor within the same
      transaction.
- [x] `approve()`: if survivor has no cohort and non-survivor does, survivor inherits
      non-survivor's cohort (within the transaction).
- [x] `approve()`: non-survivor has `is_active=false` after transaction commits.
- [x] `approve()`: MergeSuggestion `status=approved`, `decided_by`, `decided_at`
      set within the transaction.
- [x] `approve()`: `AuditEvent` with `action=merge_approve` written within the
      transaction.
- [x] `approve()`: entire transaction rolls back on any constraint violation; both
      User records remain unchanged.
- [x] `reject()`: `status=rejected`, `decided_by`, `decided_at`; AuditEvent written.
- [x] `defer()`: `status=deferred`; `decided_by` and `decided_at` remain null.
- [x] All three action methods throw a typed error if the suggestion is already
      approved or rejected.

## Implementation Plan

### Approach

1. Define `MergeConflictError` class (or import from a shared errors file).
2. Implement `findQueueItems()` using `prisma.mergeSuggestion.findMany` with
   `include: { user_a: true, user_b: true }` and `where: { status: { in: ['pending', 'deferred'] } }`.
3. Implement `findDetailById(id)` with deeper includes (logins, external_accounts).
4. Implement `approve(id, survivorId, actorId)` using Prisma interactive transaction
   `prisma.$transaction(async (tx) => { ... })`:
   - Load suggestion; validate status.
   - `tx.login.updateMany({ where: { user_id: nonSurvivorId }, data: { user_id: survivorId } })`
   - `tx.externalAccount.updateMany({ ... same pattern ... })`
   - Cohort inheritance: read both user cohort_ids; if survivor has none, copy.
   - `tx.user.update({ where: { id: nonSurvivorId }, data: { is_active: false } })`
   - `tx.mergeSuggestion.update({ ... status=approved ... })`
   - `tx.auditEvent.create({ ... })`
5. Implement `reject()` and `defer()` as simple `prisma.mergeSuggestion.update` calls
   plus AuditEvent for reject.

### Files to Create/Modify

- `server/src/services/merge-suggestion.service.ts` — expand with new methods
- `server/src/services/repositories/merge-suggestion.repository.ts` — add
  `findQueueItems` and `findDetailById` static methods if needed

### Testing Plan

Integration tests using real SQLite test DB:
- `approve()` happy path: verify Logins migrated, ExternalAccounts migrated,
  non-survivor `is_active=false`, suggestion `status=approved`.
- `approve()` constraint violation: seed two users where survivor already has a
  Login matching non-survivor's Login — verify rollback; both users intact.
- `reject()`: verify status change and AuditEvent.
- `defer()`: verify status=deferred; `decided_by` null.
- Action on already-decided suggestion: verify `MergeConflictError` thrown.

### Documentation Updates

None required.
