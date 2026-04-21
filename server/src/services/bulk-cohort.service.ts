/**
 * BulkCohortService — iterate cohort members and dispatch lifecycle operations
 * (Sprint 008, T001).
 *
 * Loads all eligible ExternalAccounts in a cohort and applies a suspend or
 * remove lifecycle operation to each, using the per-account transaction
 * pattern established in deprovision.ts. This service has no external API
 * knowledge; it delegates entirely to ExternalAccountLifecycleService.
 *
 * Fail-soft: a per-account API failure is collected and reported but does
 * not prevent processing of the remaining accounts. Each per-account
 * operation runs inside its own prisma.$transaction.
 *
 * Errors thrown:
 *  - NotFoundError (404) — cohortId does not exist.
 */

import type { PrismaClient } from '../generated/prisma/client.js';
import { NotFoundError } from '../errors.js';
import type { ExternalAccountLifecycleService } from './external-account-lifecycle.service.js';
import type { WorkspaceProvisioningService } from './workspace-provisioning.service.js';
import type { ClaudeProvisioningService } from './claude-provisioning.service.js';
import { UserRepository } from './repositories/user.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type { CohortRepository } from './repositories/cohort.repository.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AccountType = 'workspace' | 'claude';

export type BulkOperationFailure = {
  accountId: number;
  userId: number;
  userName: string;
  error: string;
};

export type BulkOperationResult = {
  succeeded: number[];
  failed: BulkOperationFailure[];
};

export type PreviewResult = {
  cohortId: number;
  accountType: AccountType;
  suspendEligible: number;
  removeEligible: number;
};

// ---------------------------------------------------------------------------
// BulkCohortService
// ---------------------------------------------------------------------------

export class BulkCohortService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly externalAccountLifecycle: ExternalAccountLifecycleService,
    private readonly userRepo: typeof UserRepository,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly cohortRepo: typeof CohortRepository,
    private readonly workspaceProvisioning?: WorkspaceProvisioningService,
    private readonly claudeProvisioning?: ClaudeProvisioningService,
  ) {}

  // ---------------------------------------------------------------------------
  // provisionCohort — create accounts for all students in the cohort that
  // don't yet have one of the given type.
  //
  // Fail-soft: one student's failure does not abort the batch. Each
  // provision call runs in its own prisma.$transaction.
  // ---------------------------------------------------------------------------
  async provisionCohort(
    cohortId: number,
    accountType: AccountType,
    actorId: number,
  ): Promise<BulkOperationResult> {
    await this._assertCohortExists(cohortId);

    const provisioner =
      accountType === 'workspace' ? this.workspaceProvisioning : this.claudeProvisioning;
    if (!provisioner) {
      throw new Error(
        `[BulkCohortService] ${accountType} provisioning service not wired. Check ServiceRegistry.`,
      );
    }

    // Active students in the cohort who do NOT already have an
    // active/pending ExternalAccount of the given type.
    const users: any[] = await (this.prisma as any).user.findMany({
      where: {
        cohort_id: cohortId,
        is_active: true,
        role: 'student',
        external_accounts: {
          none: {
            type: accountType,
            status: { in: ['active', 'pending'] },
          },
        },
      },
      select: { id: true, display_name: true, primary_email: true },
    });

    const succeeded: number[] = [];
    const failed: BulkOperationFailure[] = [];

    for (const u of users) {
      try {
        await (this.prisma as any).$transaction(async (tx: any) => {
          await provisioner.provision(u.id, actorId, tx);
        });
        succeeded.push(u.id);
      } catch (err: any) {
        failed.push({
          accountId: u.id, // reuse shape: use user id when no account exists yet
          userId: u.id,
          userName: u.display_name ?? u.primary_email ?? String(u.id),
          error: err?.message ?? String(err),
        });
      }
    }

    return { succeeded, failed };
  }

  // ---------------------------------------------------------------------------
  // suspendCohort
  // ---------------------------------------------------------------------------

  /**
   * Suspend all active ExternalAccounts of `accountType` for users in the
   * given cohort.
   *
   * For each active account found, calls
   * `externalAccountLifecycle.suspend(id, actorId, tx)` inside an individual
   * `prisma.$transaction`. Failures are collected; the loop continues.
   *
   * @throws NotFoundError if cohortId does not exist.
   */
  async suspendCohort(
    cohortId: number,
    accountType: AccountType,
    actorId: number,
  ): Promise<BulkOperationResult> {
    await this._assertCohortExists(cohortId);

    const accounts = await this._loadEligibleForSuspend(cohortId, accountType);
    return this._processAccounts(accounts, actorId, 'suspend');
  }

  // ---------------------------------------------------------------------------
  // removeCohort
  // ---------------------------------------------------------------------------

  /**
   * Remove all active/suspended ExternalAccounts of `accountType` for users
   * in the given cohort.
   *
   * For each eligible account found, calls
   * `externalAccountLifecycle.remove(id, actorId, tx)` inside an individual
   * `prisma.$transaction`. Failures are collected; the loop continues.
   *
   * @throws NotFoundError if cohortId does not exist.
   */
  async removeCohort(
    cohortId: number,
    accountType: AccountType,
    actorId: number,
  ): Promise<BulkOperationResult> {
    await this._assertCohortExists(cohortId);

    const accounts = await this._loadEligibleForRemove(cohortId, accountType);
    return this._processAccounts(accounts, actorId, 'remove');
  }

  // ---------------------------------------------------------------------------
  // previewCount
  // ---------------------------------------------------------------------------

  /**
   * Return counts of eligible accounts without mutating any record.
   *
   * @throws NotFoundError if cohortId does not exist.
   */
  async previewCount(
    cohortId: number,
    accountType: AccountType,
    operation: 'suspend' | 'remove',
  ): Promise<number> {
    await this._assertCohortExists(cohortId);

    const accounts =
      operation === 'suspend'
        ? await this._loadEligibleForSuspend(cohortId, accountType)
        : await this._loadEligibleForRemove(cohortId, accountType);

    return accounts.length;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _assertCohortExists(cohortId: number): Promise<void> {
    const cohort = await this.cohortRepo.findById(this.prisma, cohortId);
    if (!cohort) {
      throw new NotFoundError(`Cohort ${cohortId} not found`);
    }
  }

  /**
   * Load active ExternalAccounts of the given type for all active users in
   * the cohort. Includes user display_name for failure reports.
   */
  private async _loadEligibleForSuspend(
    cohortId: number,
    accountType: AccountType,
  ): Promise<Array<{ id: number; userId: number; userName: string }>> {
    const rows = await (this.prisma as any).externalAccount.findMany({
      where: {
        type: accountType,
        status: 'active',
        user: {
          cohort_id: cohortId,
          is_active: true,
        },
      },
      include: {
        user: {
          select: { id: true, display_name: true },
        },
      },
    });

    return rows.map((r: any) => ({
      id: r.id,
      userId: r.user.id,
      userName: r.user.display_name,
    }));
  }

  /**
   * Load active/suspended ExternalAccounts of the given type for all active
   * users in the cohort. Includes user display_name for failure reports.
   */
  private async _loadEligibleForRemove(
    cohortId: number,
    accountType: AccountType,
  ): Promise<Array<{ id: number; userId: number; userName: string }>> {
    const rows = await (this.prisma as any).externalAccount.findMany({
      where: {
        type: accountType,
        status: { in: ['active', 'suspended'] },
        user: {
          cohort_id: cohortId,
          is_active: true,
        },
      },
      include: {
        user: {
          select: { id: true, display_name: true },
        },
      },
    });

    return rows.map((r: any) => ({
      id: r.id,
      userId: r.user.id,
      userName: r.user.display_name,
    }));
  }

  /**
   * Iterate accounts, calling suspend or remove on each in its own
   * transaction. Collects results fail-soft.
   */
  private async _processAccounts(
    accounts: Array<{ id: number; userId: number; userName: string }>,
    actorId: number,
    operation: 'suspend' | 'remove',
  ): Promise<BulkOperationResult> {
    const succeeded: number[] = [];
    const failed: BulkOperationFailure[] = [];

    for (const account of accounts) {
      try {
        await (this.prisma as any).$transaction(async (tx: any) => {
          if (operation === 'suspend') {
            await this.externalAccountLifecycle.suspend(account.id, actorId, tx);
          } else {
            await this.externalAccountLifecycle.remove(account.id, actorId, tx);
          }
        });
        succeeded.push(account.id);
      } catch (err: any) {
        failed.push({
          accountId: account.id,
          userId: account.userId,
          userName: account.userName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { succeeded, failed };
  }
}
