/**
 * ExternalAccountService — domain logic for the ExternalAccount entity.
 *
 * Responsibilities:
 *  - Create / query ExternalAccount records
 *  - Enforce the "one active/pending account per type" invariant
 *  - Map status transitions to canonical audit action strings
 *  - Record audit events for state-changing operations
 *
 * Note: Google Workspace API and Claude Team API calls are deferred to
 * later sprints. This service covers only in-database operations.
 */

import { ConflictError, NotFoundError } from '../errors.js';
import type { AuditService, AuditAction } from './audit.service.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type { ExternalAccount } from '../generated/prisma/client.js';

type AccountType = 'workspace' | 'claude' | 'pike13';
type AccountStatus = 'pending' | 'active' | 'suspended' | 'removed';

/** Map (new status, account type) to the canonical audit action string. */
function statusToAuditAction(status: AccountStatus, type: AccountType): AuditAction {
  if (status === 'suspended') {
    if (type === 'workspace') return 'suspend_workspace';
    if (type === 'claude') return 'suspend_claude';
  }
  if (status === 'removed') {
    if (type === 'workspace') return 'remove_workspace';
    if (type === 'claude') return 'remove_claude';
  }
  // For pike13 or other status transitions not covered above, use a generic string
  return `update_external_account_${type}_${status}` as AuditAction;
}

export class ExternalAccountService {
  constructor(
    private prisma: any,
    private audit: AuditService,
  ) {}

  /**
   * Create an ExternalAccount in `pending` status.
   *
   * Throws ConflictError if an active or pending account of the same type
   * already exists for this user (enforced by the partial unique index;
   * this pre-check provides a domain-level error message).
   */
  async create(
    userId: number,
    type: AccountType,
    externalId?: string | null,
  ): Promise<ExternalAccount> {
    const existing = await ExternalAccountRepository.findActiveByUserAndType(
      this.prisma,
      userId,
      type,
    );
    if (existing) {
      throw new ConflictError(
        `User ${userId} already has an active or pending ${type} account`,
      );
    }

    return ExternalAccountRepository.create(this.prisma, {
      user_id: userId,
      type,
      external_id: externalId ?? null,
      status: 'pending',
    });
  }

  /** Return all ExternalAccount records for a user. */
  async findAllByUser(userId: number): Promise<ExternalAccount[]> {
    return ExternalAccountRepository.findAllByUser(this.prisma, userId);
  }

  /**
   * Return the active or pending account of the given type for a user.
   * Returns null if no such account exists.
   */
  async findActiveByUserAndType(
    userId: number,
    type: AccountType,
  ): Promise<ExternalAccount | null> {
    return ExternalAccountRepository.findActiveByUserAndType(this.prisma, userId, type);
  }

  /**
   * Update the status of an ExternalAccount and record the appropriate
   * audit event atomically.
   *
   * Throws NotFoundError if the account does not exist.
   */
  async updateStatus(
    accountId: number,
    status: AccountStatus,
    actorId: number | null = null,
  ): Promise<ExternalAccount> {
    const account = await ExternalAccountRepository.findById(this.prisma, accountId);
    if (!account) throw new NotFoundError(`ExternalAccount ${accountId} not found`);

    const action = statusToAuditAction(status, account.type as AccountType);

    return this.prisma.$transaction(async (tx: any) => {
      const updated = await ExternalAccountRepository.updateStatus(tx, accountId, status);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action,
        target_user_id: account.user_id,
        target_entity_type: 'ExternalAccount',
        target_entity_id: String(accountId),
        details: { type: account.type, status },
      });
      return updated;
    });
  }
}
