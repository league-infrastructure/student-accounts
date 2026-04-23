/**
 * BulkGroupService — iterate group members and dispatch provisioning /
 * lifecycle operations (Sprint 012 T003).
 *
 * Mirrors `BulkCohortService` but scopes to app-level Group membership
 * instead of cohort assignment. Both services share the
 * `processAccounts` helper from `bulk-account.shared.ts` so the per-
 * account transaction + fail-soft loop is defined once.
 *
 * Eligibility SQL is service-owned because the scoping predicates differ:
 *   - cohort:  user.cohort_id = :id
 *   - group :  user.groups SOME group_id = :id
 *
 * Errors thrown:
 *   - NotFoundError (404) — groupId does not exist.
 */

import { NotFoundError } from '../errors.js';
import { GroupRepository } from './repositories/group.repository.js';
import type { ExternalAccountLifecycleService } from './external-account-lifecycle.service.js';
import type { WorkspaceProvisioningService } from './workspace-provisioning.service.js';
import type { ClaudeProvisioningService } from './claude-provisioning.service.js';
import {
  processAccounts,
  type AccountRow,
  type AccountType,
  type BulkOperationFailure,
  type BulkOperationResult,
} from './bulk-account.shared.js';

export type { AccountType, BulkOperationResult, BulkOperationFailure };

export class BulkGroupService {
  constructor(
    private readonly prisma: any,
    private readonly externalAccountLifecycle: ExternalAccountLifecycleService,
    private readonly workspaceProvisioning?: WorkspaceProvisioningService,
    private readonly claudeProvisioning?: ClaudeProvisioningService,
  ) {}

  // -----------------------------------------------------------------
  // provisionGroup
  // -----------------------------------------------------------------

  /**
   * Create accounts of `accountType` for every active member of the
   * group that does not already have an active/pending account of that
   * type. Fail-soft per user.
   *
   * If userIds is provided, only operates on those users (must be members of the group).
   * If userIds is omitted, operates on all members.
   */
  async provisionGroup(
    groupId: number,
    accountType: AccountType,
    actorId: number,
    userIds?: number[],
  ): Promise<BulkOperationResult> {
    await this._assertGroupExists(groupId);

    const provisioner =
      accountType === 'workspace'
        ? this.workspaceProvisioning
        : this.claudeProvisioning;
    if (!provisioner) {
      throw new Error(
        `[BulkGroupService] ${accountType} provisioning service not wired. Check ServiceRegistry.`,
      );
    }

    const userIdFilter = userIds && userIds.length > 0 ? { in: userIds } : undefined;

    const users: any[] = await (this.prisma as any).user.findMany({
      where: {
        ...(userIdFilter && { id: userIdFilter }),
        is_active: true,
        groups: { some: { group_id: groupId } },
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
          accountId: u.id,
          userId: u.id,
          userName: u.display_name ?? u.primary_email ?? String(u.id),
          error: err?.message ?? String(err),
        });
      }
    }

    return { succeeded, failed };
  }

  // -----------------------------------------------------------------
  // suspendAllInGroup
  // -----------------------------------------------------------------

  async suspendAllInGroup(
    groupId: number,
    actorId: number,
    userIds?: number[],
  ): Promise<BulkOperationResult> {
    await this._assertGroupExists(groupId);
    const accounts = await this._loadAllEligibleForSuspend(groupId, userIds);
    return processAccounts(
      this.prisma,
      this.externalAccountLifecycle,
      accounts,
      actorId,
      'suspend',
    );
  }

  // -----------------------------------------------------------------
  // removeAllInGroup
  // -----------------------------------------------------------------

  async removeAllInGroup(
    groupId: number,
    actorId: number,
    userIds?: number[],
  ): Promise<BulkOperationResult> {
    await this._assertGroupExists(groupId);
    const accounts = await this._loadAllEligibleForRemove(groupId, userIds);
    return processAccounts(
      this.prisma,
      this.externalAccountLifecycle,
      accounts,
      actorId,
      'remove',
    );
  }

  // -----------------------------------------------------------------
  // previewCount
  // -----------------------------------------------------------------

  /**
   * Return the number of accounts that would be touched by a suspend or
   * remove operation of the given type. Does not mutate any record.
   */
  async previewCount(
    groupId: number,
    accountType: AccountType,
    operation: 'suspend' | 'remove',
  ): Promise<number> {
    await this._assertGroupExists(groupId);
    const statuses =
      operation === 'suspend' ? ['active'] : ['active', 'suspended'];
    return (this.prisma as any).externalAccount.count({
      where: {
        type: accountType,
        status: { in: statuses },
        user: {
          is_active: true,
          groups: { some: { group_id: groupId } },
        },
      },
    });
  }

  // -----------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------

  private async _assertGroupExists(groupId: number): Promise<void> {
    const g = await GroupRepository.findById(this.prisma, groupId);
    if (!g) throw new NotFoundError(`Group ${groupId} not found`);
  }

  /** Load active workspace + claude accounts for active members of the group. */
  private async _loadAllEligibleForSuspend(
    groupId: number,
    userIds?: number[],
  ): Promise<AccountRow[]> {
    const userIdFilter = userIds && userIds.length > 0 ? { in: userIds } : undefined;

    const rows = await (this.prisma as any).externalAccount.findMany({
      where: {
        type: { in: ['workspace', 'claude'] },
        status: 'active',
        user: {
          ...(userIdFilter && { id: userIdFilter }),
          is_active: true,
          groups: { some: { group_id: groupId } },
        },
      },
      include: { user: { select: { id: true, display_name: true } } },
    });
    return rows.map((r: any) => ({
      id: r.id,
      userId: r.user.id,
      userName: r.user.display_name,
      type: r.type as AccountType,
    }));
  }

  /** Load active + suspended workspace + claude accounts for active members. */
  private async _loadAllEligibleForRemove(
    groupId: number,
    userIds?: number[],
  ): Promise<AccountRow[]> {
    const userIdFilter = userIds && userIds.length > 0 ? { in: userIds } : undefined;

    const rows = await (this.prisma as any).externalAccount.findMany({
      where: {
        type: { in: ['workspace', 'claude'] },
        status: { in: ['active', 'suspended'] },
        user: {
          ...(userIdFilter && { id: userIdFilter }),
          is_active: true,
          groups: { some: { group_id: groupId } },
        },
      },
      include: { user: { select: { id: true, display_name: true } } },
    });
    return rows.map((r: any) => ({
      id: r.id,
      userId: r.user.id,
      userName: r.user.display_name,
      type: r.type as AccountType,
    }));
  }
}
