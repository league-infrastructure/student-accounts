---
id: "003"
title: "Shared bulk helper + BulkGroupService"
status: todo
use-cases: ["SUC-012-006", "SUC-012-007", "SUC-012-008"]
depends-on: ["001", "002"]
github-issue: ""
todo: ""
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Shared bulk helper + BulkGroupService

## Description

Factor the per-account transaction + fail-soft loop out of
`BulkCohortService` into a shared helper module, then add a new
`BulkGroupService` that scopes the same operations to group
membership.

## Acceptance Criteria

- [ ] New file `server/src/services/bulk-account.shared.ts` exports:
      - `AccountType = 'workspace' | 'claude'`.
      - `BulkOperationFailure` (same shape as current
        `bulk-cohort.service.ts`).
      - `BulkOperationResult = { succeeded: number[]; failed: BulkOperationFailure[] }`.
      - `async function processAccounts(prisma, lifecycle,
        accounts, actorId, operation)` — iterates each account,
        opens a per-account `prisma.$transaction`, calls
        `lifecycle.suspend` or `lifecycle.remove`, and collects
        results. `type` on failure entries is carried through if
        the input row supplies one.
- [ ] `BulkCohortService` is refactored to import `processAccounts`,
      `AccountType`, and the result types from
      `bulk-account.shared.ts`. Its public API is unchanged. The
      private `_processAccounts` method is removed.
- [ ] Existing `bulk-cohort.service.test.ts` (if present) and
      `bulk-cohort.routes.test.ts` still pass unchanged.
- [ ] New file `server/src/services/bulk-group.service.ts` exports
      `BulkGroupService` with:
      - `previewCount(groupId, accountType, operation)` — eligible
        account count; throws `NotFoundError` if group missing.
      - `provisionGroup(groupId, accountType, actorId)` —
        iterates active members without an active/pending
        `ExternalAccount` of the given type; calls the matching
        provisioning service; returns `BulkOperationResult`.
      - `suspendAllInGroup(groupId, actorId)` — loads every active
        `workspace` + `claude` ExternalAccount for active members
        and runs `processAccounts(..., 'suspend')`.
      - `removeAllInGroup(groupId, actorId)` — same with
        `active` | `suspended` statuses and `'remove'`.
- [ ] Registered on `ServiceRegistry` as `bulkGroup: BulkGroupService`
      with the same provisioner wiring as `bulkCohort`.
- [ ] Unit tests in
      `tests/server/services/bulk-group.service.test.ts` cover
      eligibility scoping, fail-soft per-account, `NotFoundError`
      on missing group, and the `type`-carrying failure shape for
      `*-all` methods.

## Testing

- **Existing tests to run**: `npm run test:server` — all existing
  bulk-cohort tests must pass unchanged after the refactor.
- **New tests to write**: `bulk-group.service.test.ts`.
- **Verification command**: `npm run test:server`.
