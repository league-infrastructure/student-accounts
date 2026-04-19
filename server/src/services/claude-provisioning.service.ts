/**
 * ClaudeProvisioningService — executes Claude Team seat provisioning.
 *
 * This service is the sole entry point for Claude seat provisioning: it
 * validates preconditions, calls the Claude Team Admin API to invite the
 * member, persists the ExternalAccount row, and emits the audit event. All
 * database writes occur inside the caller-supplied transaction.
 *
 * The caller owns the transaction boundary. This service does NOT open its
 * own prisma.$transaction.
 *
 * Hard gate: the user must have an active workspace ExternalAccount. The
 * workspace account's external_id holds the League Workspace email address,
 * which is passed to ClaudeTeamAdminClient.inviteMember.
 *
 * Dependency injection:
 *  - claudeTeamClient      — ClaudeTeamAdminClient (real or fake)
 *  - externalAccountRepo   — ExternalAccountRepository (writes inside tx)
 *  - auditService          — AuditService
 *  - userRepo              — UserRepository (reads inside tx)
 *
 * Errors thrown:
 *  - UnprocessableError (422) — precondition failures (user not found, no active
 *    workspace ExternalAccount).
 *  - ConflictError (409) — an active or pending claude ExternalAccount already
 *    exists for the user.
 *  - ClaudeTeamApiError / ClaudeTeamWriteDisabledError — propagated from the
 *    Claude Team client as-is.
 */

import pino from 'pino';

import { ConflictError, UnprocessableError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { ClaudeTeamAdminClient } from './claude-team/claude-team-admin.client.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import type { ExternalAccount, Prisma } from '../generated/prisma/client.js';

const logger = pino({ name: 'claude-provisioning' });

export class ClaudeProvisioningService {
  constructor(
    private readonly claudeTeamClient: ClaudeTeamAdminClient,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly auditService: AuditService,
    private readonly userRepo: typeof UserRepository,
  ) {}

  /**
   * Provision a Claude Team seat for the given user.
   *
   * All database writes are performed inside the provided transaction client.
   * The caller is responsible for opening and committing (or rolling back) the
   * transaction. If the Claude Team API call fails, no ExternalAccount row is
   * written — the caller's transaction will roll back naturally if desired.
   *
   * @param userId  - The student whose Claude seat is being provisioned.
   * @param actorId - The admin performing the provisioning action.
   * @param tx      - The caller's Prisma transaction client.
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
    tx: Prisma.TransactionClient,
  ): Promise<ExternalAccount> {
    // --- 1. Fetch user ---
    const user = await this.userRepo.findById(tx, userId);
    if (!user) {
      throw new UnprocessableError(`User ${userId} not found`);
    }

    // --- 2. Verify active workspace ExternalAccount exists (hard gate) ---
    const workspaceAccount = await this.externalAccountRepo.findActiveByUserAndType(
      tx,
      userId,
      'workspace',
    );
    if (!workspaceAccount) {
      throw new UnprocessableError(
        `User ${userId} does not have an active workspace ExternalAccount. ` +
          `Provision a Workspace account before provisioning a Claude seat.`,
      );
    }

    // The workspace account's external_id holds the League Workspace email.
    const workspaceEmail = workspaceAccount.external_id;
    if (!workspaceEmail) {
      throw new UnprocessableError(
        `User ${userId} has a workspace ExternalAccount (id=${workspaceAccount.id}) ` +
          `but its external_id (workspace email) is null. Cannot derive email for Claude invite.`,
      );
    }

    // --- 3. Check no active/pending claude ExternalAccount exists ---
    const existingClaude = await this.externalAccountRepo.findActiveByUserAndType(
      tx,
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
      '[claude-provisioning] Calling ClaudeTeamAdminClient.inviteMember',
    );

    // --- 4. Call Claude Team API (may throw; caller's tx rolls back) ---
    const member = await this.claudeTeamClient.inviteMember({ email: workspaceEmail });

    logger.info(
      { userId, memberId: member.id, email: member.email, status: member.status },
      '[claude-provisioning] Claude Team member invited successfully',
    );

    // --- 5. Persist ExternalAccount inside the caller's transaction ---
    const newAccount = await this.externalAccountRepo.create(tx, {
      user_id: userId,
      type: 'claude',
      status: 'active',
      external_id: member.id,
      status_changed_at: new Date(),
    });

    // --- 6. Record audit event inside the caller's transaction ---
    await this.auditService.record(tx, {
      actor_user_id: actorId,
      action: 'provision_claude',
      target_user_id: userId,
      target_entity_type: 'ExternalAccount',
      target_entity_id: String(newAccount.id),
      details: {
        workspaceEmail,
        claudeMemberId: member.id,
        claudeMemberStatus: member.status,
      },
    });

    logger.info(
      { userId, actorId, externalAccountId: newAccount.id, workspaceEmail },
      '[claude-provisioning] Claude provisioning complete',
    );

    return newAccount;
  }
}
