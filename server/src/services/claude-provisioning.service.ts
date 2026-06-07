/**
 * ClaudeProvisioningService — executes Claude Team seat provisioning.
 *
 * This service is the sole entry point for Claude seat provisioning: it
 * validates preconditions, calls the Anthropic Admin API to invite the
 * member, persists the ExternalAccount row, and emits the audit event.
 *
 * Transaction boundary: the external Anthropic API call runs OUTSIDE any
 * SQLite transaction. Only the final ExternalAccount + audit writes are
 * wrapped in a short internal $transaction. This prevents the SQLite write
 * lock from being held during network I/O, which caused P2028 timeouts.
 *
 * Hard gate: the user must have an active workspace ExternalAccount. The
 * workspace account's external_id holds the League Workspace email address,
 * which is passed to AnthropicAdminClient.inviteToOrg.
 *
 * Dependency injection:
 *  - claudeTeamClient      — AnthropicAdminClient (real or fake)
 *  - externalAccountRepo   — ExternalAccountRepository
 *  - auditService          — AuditService
 *  - userRepo              — UserRepository
 *
 * Errors thrown:
 *  - UnprocessableError (422) — precondition failures (user not found, no active
 *    workspace ExternalAccount).
 *  - ConflictError (409) — an active or pending claude ExternalAccount already
 *    exists for the user.
 *  - ClaudeTeamApiError / ClaudeTeamWriteDisabledError — propagated from the
 *    Claude Team client as-is.
 */

import { createLogger } from './logger.js';

import { ConflictError, UnprocessableError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { AnthropicAdminClient } from './anthropic/anthropic-admin.client.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import type { ExternalAccount } from '../generated/prisma/client.js';
import { prisma as defaultPrisma } from './prisma.js';

const logger = createLogger('claude-provisioning');

export class ClaudeProvisioningService {
  constructor(
    private readonly claudeTeamClient: AnthropicAdminClient,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly auditService: AuditService,
    private readonly userRepo: typeof UserRepository,
  ) {}

  /**
   * Provision a Claude Team seat for the given user.
   *
   * External API call (Anthropic) runs BEFORE any database transaction so
   * the SQLite write lock is never held during network I/O. Only the final
   * ExternalAccount + audit writes are wrapped in a short internal $transaction.
   *
   * @param userId  - The student whose Claude seat is being provisioned.
   * @param actorId - The admin performing the provisioning action.
   * @returns The newly created ExternalAccount row.
   *
   * @throws UnprocessableError if the user is not found or has no active
   *         workspace ExternalAccount.
   * @throws ConflictError if an active or pending claude ExternalAccount
   *         already exists for the user.
   * @throws ClaudeTeamApiError | ClaudeTeamWriteDisabledError propagated from
   *         the Claude Team client.
   */
  async provision(
    userId: number,
    actorId: number,
  ): Promise<ExternalAccount> {
    // --- 1. Pre-flight reads (outside transaction — no lock held) ---
    const user = await this.userRepo.findById(defaultPrisma, userId);
    if (!user) {
      throw new UnprocessableError(`User ${userId} not found`);
    }

    // --- 2. Resolve the League email to invite ---
    const workspaceAccount = await this.externalAccountRepo.findActiveByUserAndType(
      defaultPrisma,
      userId,
      'workspace',
    );

    const userEmail = (user.primary_email ?? '').toLowerCase();
    const isLeagueEmail = /@([a-z0-9-]+\.)?jointheleague\.org$/.test(userEmail);

    const workspaceEmail: string | null =
      workspaceAccount?.external_id ??
      (isLeagueEmail ? user.primary_email : null);

    if (!workspaceEmail) {
      throw new UnprocessableError(
        `User ${userId} has no League Workspace account. Their primary email ` +
          `(${user.primary_email ?? 'none'}) is not on jointheleague.org and ` +
          `they have no active workspace ExternalAccount. Provision a ` +
          `Workspace account before provisioning a Claude seat.`,
      );
    }

    // --- 3. Check no active/pending claude ExternalAccount exists ---
    const existingClaude = await this.externalAccountRepo.findActiveByUserAndType(
      defaultPrisma,
      userId,
      'claude',
    );
    if (existingClaude) {
      throw new ConflictError(
        `User ${userId} already has an active or pending claude ExternalAccount (id=${existingClaude.id})`,
      );
    }

    logger.info(
      { userId, actorId, workspaceEmail },
      '[claude-provisioning] Calling AnthropicAdminClient.inviteToOrg',
    );

    // --- 4. External: Anthropic Admin API (outside transaction) ---
    const member = await this.claudeTeamClient.inviteToOrg({ email: workspaceEmail });

    logger.info(
      { userId, memberId: member.id, email: member.email, status: member.status },
      '[claude-provisioning] Claude Team member invited successfully',
    );

    // --- 5. Short transaction for DB writes only ---
    const newAccount = await defaultPrisma.$transaction(async (tx: any) => {
      const account = await this.externalAccountRepo.create(tx, {
        user_id: userId,
        type: 'claude',
        status: 'pending',
        external_id: member.id,
        status_changed_at: new Date(),
      });
      await this.auditService.record(tx, {
        actor_user_id: actorId,
        action: 'provision_claude',
        target_user_id: userId,
        target_entity_type: 'ExternalAccount',
        target_entity_id: String(account.id),
        details: {
          workspaceEmail,
          claudeMemberId: member.id,
          claudeMemberStatus: member.status,
        },
      });
      return account;
    });

    logger.info(
      { userId, actorId, externalAccountId: newAccount.id, workspaceEmail },
      '[claude-provisioning] Claude provisioning complete',
    );

    return newAccount;
  }
}
