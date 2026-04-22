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

import { createLogger } from './logger.js';

import { ConflictError, UnprocessableError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { AnthropicAdminClient } from './anthropic/anthropic-admin.client.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import type { ExternalAccount, Prisma } from '../generated/prisma/client.js';

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

    // --- 2. Resolve the League email to invite ---
    //
    // Preferred source: an active workspace ExternalAccount whose external_id
    // holds the League Workspace email. Workspace sync (Sprint 006) does NOT
    // create ExternalAccount rows — only User rows — so for Google-imported
    // students we fall back to User.primary_email when it's on a
    // jointheleague.org domain (including subdomains like
    // @students.jointheleague.org). That email is, by construction, the
    // user's Google Workspace account.
    const workspaceAccount = await this.externalAccountRepo.findActiveByUserAndType(
      tx,
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
      '[claude-provisioning] Calling AnthropicAdminClient.inviteToOrg',
    );

    // --- 4. Call Anthropic Admin API (may throw; caller's tx rolls back) ---
    const member = await this.claudeTeamClient.inviteToOrg({ email: workspaceEmail });

    logger.info(
      { userId, memberId: member.id, email: member.email, status: member.status },
      '[claude-provisioning] Claude Team member invited successfully',
    );

    // --- 5. Persist ExternalAccount inside the caller's transaction ---
    // The invite creates a pending seat — status transitions to active once the
    // invitee accepts (reconciled by AnthropicSyncService.reconcile).
    const newAccount = await this.externalAccountRepo.create(tx, {
      user_id: userId,
      type: 'claude',
      status: 'pending',
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
