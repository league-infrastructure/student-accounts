/**
 * Shared primitives for bulk-account operations across cohorts and groups
 * (Sprint 012 T003).
 *
 * This module captures the genuinely-common mechanics between
 * `BulkCohortService` and `BulkGroupService`:
 *
 *  - `AccountType` — the two lifecycle-aware account kinds we bulk-operate
 *    on: workspace and claude.
 *  - `BulkOperationFailure` / `BulkOperationResult` — the succeeded /
 *    failed-with-reasons shape admin UIs render.
 *  - `processAccounts()` — iterate a list of account rows, run the chosen
 *    lifecycle operation inside a per-account `prisma.$transaction`, and
 *    collect succeeded + failed into one result.
 *
 * Each bulk service still owns its own eligibility SQL because the
 * scoping predicates differ: cohort = `user.cohort_id`, group = `user in
 * UserGroup`. Only the mechanical loop is shared here.
 *
 * History: this module extracts what was previously
 * `BulkCohortService._processAccounts`. That method was removed; the
 * service now delegates here.
 */

import type { ExternalAccountLifecycleService } from './external-account-lifecycle.service.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AccountType = 'workspace' | 'claude';

export type BulkOperationFailure = {
  accountId: number;
  userId: number;
  userName: string;
  /**
   * Optional account type — populated by the bulk methods that mix
   * workspace + claude accounts in one batch (suspendAllIn*, removeAllIn*)
   * so the UI can render "name (claude): reason". Omitted by per-type
   * methods where type is implicit from the request.
   */
  type?: AccountType;
  error: string;
};

export type BulkOperationResult = {
  succeeded: number[];
  failed: BulkOperationFailure[];
};

/** Shape accepted by processAccounts(). */
export type AccountRow = {
  id: number;
  userId: number;
  userName: string;
  type?: AccountType;
};

// ---------------------------------------------------------------------------
// processAccounts
// ---------------------------------------------------------------------------

/**
 * Apply a lifecycle operation (`suspend` or `remove`) to every account in
 * `accounts`. Each call runs in its own `prisma.$transaction` so a per-
 * account failure does not abort the batch.
 *
 * @param prisma    - Prisma client (or any client that exposes `$transaction`).
 * @param lifecycle - `ExternalAccountLifecycleService` to dispatch to.
 * @param accounts  - Already-eligible rows. Callers produce this list via
 *                    their own eligibility SQL.
 * @param actorId   - Actor recorded in audit events emitted by lifecycle.
 * @param operation - Lifecycle method to invoke.
 */
export async function processAccounts(
  prisma: any,
  lifecycle: ExternalAccountLifecycleService,
  accounts: AccountRow[],
  actorId: number,
  operation: 'suspend' | 'remove',
): Promise<BulkOperationResult> {
  const succeeded: number[] = [];
  const failed: BulkOperationFailure[] = [];

  for (const account of accounts) {
    try {
      await prisma.$transaction(async (tx: any) => {
        if (operation === 'suspend') {
          await lifecycle.suspend(account.id, actorId, tx);
        } else {
          await lifecycle.remove(account.id, actorId, tx);
        }
      });
      succeeded.push(account.id);
    } catch (err: any) {
      const entry: BulkOperationFailure = {
        accountId: account.id,
        userId: account.userId,
        userName: account.userName,
        error: err instanceof Error ? err.message : String(err),
      };
      if (account.type !== undefined) entry.type = account.type;
      failed.push(entry);
    }
  }

  return { succeeded, failed };
}
