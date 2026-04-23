/**
 * ExternalAccountLifecycleService — suspend and remove operations on individual
 * ExternalAccount records (Sprint 005, T005).
 *
 * This service routes API calls to the correct external client based on
 * account type, updates the ExternalAccount row, and emits audit events.
 * All database writes occur inside the caller-supplied transaction.
 *
 * The caller owns the transaction boundary. This service does NOT open its
 * own prisma.$transaction.
 *
 * Dependency injection:
 *  - googleClient          — GoogleWorkspaceAdminClient (real or fake)
 *  - claudeTeamClient      — AnthropicAdminClient (real or fake)
 *  - externalAccountRepo   — ExternalAccountRepository (writes inside tx)
 *  - auditService          — AuditService
 *
 * Environment variables consumed:
 *  - WORKSPACE_DELETE_DELAY_DAYS  — optional; number of days before a removed
 *    workspace account is hard-deleted (default 3).
 *  - CLAUDE_STUDENT_WORKSPACE     — name of the Students workspace in Anthropic
 *    (default "Students"). Used to look up the workspace ID for suspend calls.
 *
 * Errors thrown:
 *  - NotFoundError (404)       — accountId does not exist.
 *  - UnprocessableError (422)  — account is already in status=removed.
 *  - GoogleWorkspaceAdminClient errors — propagated as-is.
 *  - AnthropicAdminClient errors       — propagated as-is.
 */

import { createLogger } from './logger.js';

import { NotFoundError, UnprocessableError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { GoogleWorkspaceAdminClient } from './google-workspace/google-workspace-admin.client.js';
import type { AnthropicAdminClient } from './anthropic/anthropic-admin.client.js';
import { AnthropicAdminApiError } from './anthropic/anthropic-admin.client.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type { ExternalAccount, Prisma } from '../generated/prisma/client.js';

const logger = createLogger('external-account-lifecycle');

/** Default number of days between workspace removal and hard-delete. */
const DEFAULT_WORKSPACE_DELETE_DELAY_DAYS = 3;

export class ExternalAccountLifecycleService {
  /** Cached Students workspace ID (resolved once per process). */
  private studentsWorkspaceIdCache: string | undefined;

  constructor(
    private readonly googleClient: GoogleWorkspaceAdminClient,
    private readonly claudeTeamClient: AnthropicAdminClient,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Resolve the Students workspace ID for Anthropic workspace operations.
   *
   * Calls listWorkspaces() once and caches the result for the lifetime of
   * this service instance. Uses CLAUDE_STUDENT_WORKSPACE env var (default
   * "Students") as the target name.
   *
   * Returns null when CLAUDE_STUDENT_WORKSPACE is not set, or when the
   * named workspace is not found. Suspend on Claude is still allowed in
   * that case; it just becomes a no-op at the workspace layer and only
   * records the status change locally.
   */
  private async resolveStudentsWorkspaceId(): Promise<string | null> {
    if (this.studentsWorkspaceIdCache !== undefined) {
      return this.studentsWorkspaceIdCache;
    }

    const targetName = process.env.CLAUDE_STUDENT_WORKSPACE;
    if (!targetName) {
      this.studentsWorkspaceIdCache = null as any;
      return null;
    }

    try {
      const workspaces = await this.claudeTeamClient.listWorkspaces();
      const workspace = workspaces.find((ws) => ws.name === targetName);
      if (!workspace) {
        logger.warn(
          { targetName, available: workspaces.map((w) => w.name) },
          '[external-account-lifecycle] target workspace not found — suspend will only update local status',
        );
        this.studentsWorkspaceIdCache = null as any;
        return null;
      }
      this.studentsWorkspaceIdCache = workspace.id;
      return workspace.id;
    } catch (err) {
      logger.warn({ err }, '[external-account-lifecycle] listWorkspaces failed — suspend will only update local status');
      this.studentsWorkspaceIdCache = null as any;
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // suspend
  // ---------------------------------------------------------------------------

  /**
   * Suspend an external account.
   *
   * For workspace: calls GoogleWorkspaceAdminClient.suspendUser and sets
   * status=suspended, status_changed_at=now.
   *
   * For claude: calls ClaudeTeamAdminClient.suspendMember (which is currently
   * a documented no-op per OQ-003) and sets status=suspended, status_changed_at=now.
   *
   * @throws NotFoundError      if accountId does not exist.
   * @throws UnprocessableError if the account is already status=removed.
   */
  async suspend(
    accountId: number,
    actorId: number,
    tx: Prisma.TransactionClient,
  ): Promise<ExternalAccount> {
    // --- 1. Fetch and validate ---
    const account = await this.externalAccountRepo.findById(tx, accountId);
    if (!account) {
      throw new NotFoundError(`ExternalAccount ${accountId} not found`);
    }
    if (account.status === 'removed') {
      throw new UnprocessableError(
        `ExternalAccount ${accountId} is already removed and cannot be suspended`,
      );
    }

    logger.info(
      { accountId, actorId, type: account.type, currentStatus: account.status },
      '[external-account-lifecycle] suspend: starting',
    );

    // --- 2. Call external API ---
    if (account.type === 'workspace') {
      const email = account.external_id;
      if (!email) {
        throw new UnprocessableError(
          `ExternalAccount ${accountId} has no external_id (workspace email); cannot suspend`,
        );
      }
      await this.googleClient.suspendUser(email);
      logger.info({ accountId, email }, '[external-account-lifecycle] suspend: workspace user suspended');
    } else if (account.type === 'claude') {
      const memberId = account.external_id;
      if (!memberId) {
        throw new UnprocessableError(
          `ExternalAccount ${accountId} has no external_id (Claude member id); cannot suspend`,
        );
      }
      if (memberId.startsWith('invite_')) {
        // The invite was never accepted, so there's nothing in any
        // workspace to remove. Cancel the outstanding invite so the
        // student can't accept it out of band.
        try {
          await this.claudeTeamClient.cancelInvite(memberId);
          logger.info(
            { accountId, memberId },
            '[external-account-lifecycle] suspend: cancelled outstanding Claude invite',
          );
        } catch (err) {
          logger.warn(
            { accountId, memberId, err },
            '[external-account-lifecycle] suspend: cancelInvite failed — continuing with local status update',
          );
        }
      } else {
        const studentsWsId = await this.resolveStudentsWorkspaceId();
        if (studentsWsId) {
          try {
            await this.claudeTeamClient.removeUserFromWorkspace(studentsWsId, memberId);
            logger.info(
              { accountId, memberId, studentsWsId },
              '[external-account-lifecycle] suspend: claude user removed from Students workspace',
            );
          } catch (err) {
            logger.warn(
              { accountId, memberId, studentsWsId, err },
              '[external-account-lifecycle] suspend: removeUserFromWorkspace failed — continuing with local status update',
            );
          }
        }
      }
    }

    // --- 3. Persist status change ---
    const now = new Date();
    const updated = await this.externalAccountRepo.update(tx, accountId, {
      status: 'suspended',
      status_changed_at: now,
    });

    // --- 4. Emit audit event ---
    const action = account.type === 'workspace' ? 'suspend_workspace' : 'suspend_claude';
    await this.auditService.record(tx, {
      actor_user_id: actorId,
      action,
      target_user_id: account.user_id,
      target_entity_type: 'ExternalAccount',
      target_entity_id: String(accountId),
      details: {
        previousStatus: account.status,
        externalId: account.external_id,
      },
    });

    logger.info(
      { accountId, actorId, action },
      '[external-account-lifecycle] suspend: complete',
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // unsuspend
  // ---------------------------------------------------------------------------

  /**
   * Un-suspend an external account that is currently `status='suspended'`.
   *
   * For workspace: calls `googleClient.unsuspendUser(email)` (the same method
   * used by WorkspaceProvisioningService.provision() when reactivating a
   * prior-suspended workspace). On success the row flips to `status='active'`.
   *
   * For claude: branches on the external_id prefix.
   *   - `invite_*`  — best-effort cancelInvite(oldId), then inviteToOrg({ email }),
   *     persist the new invite id as external_id, flip status to `pending`.
   *     The email is derived from the user's workspace ExternalAccount
   *     `external_id` (which by convention on this project is the League
   *     email), falling back to `user.primary_email`.
   *   - `user_*` / anything else — throw UnprocessableError with the
   *     "delete and re-provision" message. Anthropic's API does not expose
   *     a clean re-activation for a suspended organization user.
   *
   * @throws NotFoundError      if accountId does not exist.
   * @throws UnprocessableError if the account is not currently suspended,
   *   or if claude un-suspend is attempted against a non-invite external_id,
   *   or if no League email can be derived for a claude re-invite.
   */
  async unsuspend(
    accountId: number,
    actorId: number,
    tx: Prisma.TransactionClient,
  ): Promise<ExternalAccount> {
    // --- 1. Fetch and validate ---
    const account = await this.externalAccountRepo.findById(tx, accountId);
    if (!account) {
      throw new NotFoundError(`ExternalAccount ${accountId} not found`);
    }
    if (account.status !== 'suspended') {
      throw new UnprocessableError(
        `ExternalAccount ${accountId} is not suspended (current status: ${account.status})`,
      );
    }

    logger.info(
      { accountId, actorId, type: account.type, currentStatus: account.status },
      '[external-account-lifecycle] unsuspend: starting',
    );

    // --- 2. Dispatch by account type ---
    const now = new Date();

    if (account.type === 'workspace') {
      const email = account.external_id;
      if (!email) {
        throw new UnprocessableError(
          `ExternalAccount ${accountId} has no external_id (workspace email); cannot unsuspend`,
        );
      }
      await this.googleClient.unsuspendUser(email);
      logger.info(
        { accountId, email },
        '[external-account-lifecycle] unsuspend: workspace user reactivated',
      );

      const updated = await this.externalAccountRepo.update(tx, accountId, {
        status: 'active',
        status_changed_at: now,
      });

      await this.auditService.record(tx, {
        actor_user_id: actorId,
        action: 'unsuspend_workspace',
        target_user_id: account.user_id,
        target_entity_type: 'ExternalAccount',
        target_entity_id: String(accountId),
        details: {
          previousStatus: account.status,
          externalId: account.external_id,
        },
      });

      logger.info(
        { accountId, actorId, action: 'unsuspend_workspace' },
        '[external-account-lifecycle] unsuspend: complete',
      );

      return updated;
    }

    if (account.type === 'claude') {
      const memberId = account.external_id;
      if (!memberId) {
        throw new UnprocessableError(
          `ExternalAccount ${accountId} has no external_id (Claude id); cannot unsuspend`,
        );
      }
      if (!memberId.startsWith('invite_')) {
        throw new UnprocessableError(
          'Claude user accounts cannot be un-suspended; delete this account and ' +
            're-provision a new Claude seat instead.',
        );
      }

      // Derive the League email for the re-invite.
      const leagueEmail = await this.resolveLeagueEmailForUser(tx, account.user_id);
      if (!leagueEmail) {
        throw new UnprocessableError(
          `ExternalAccount ${accountId} user has no derivable League email; cannot re-invite`,
        );
      }

      // Best-effort cancel of the old invite so the student can't accept the stale one.
      try {
        await this.claudeTeamClient.cancelInvite(memberId);
        logger.info(
          { accountId, oldInviteId: memberId },
          '[external-account-lifecycle] unsuspend: cancelled previous Claude invite',
        );
      } catch (err) {
        logger.warn(
          { accountId, oldInviteId: memberId, err },
          '[external-account-lifecycle] unsuspend: cancelInvite failed — continuing with fresh invite',
        );
      }

      const fresh = await this.claudeTeamClient.inviteToOrg({ email: leagueEmail });
      logger.info(
        { accountId, newInviteId: fresh.id, email: leagueEmail },
        '[external-account-lifecycle] unsuspend: new Claude invite sent',
      );

      const updated = await this.externalAccountRepo.update(tx, accountId, {
        status: 'pending',
        status_changed_at: now,
        external_id: fresh.id,
      });

      await this.auditService.record(tx, {
        actor_user_id: actorId,
        action: 'unsuspend_claude',
        target_user_id: account.user_id,
        target_entity_type: 'ExternalAccount',
        target_entity_id: String(accountId),
        details: {
          previousStatus: account.status,
          previousExternalId: memberId,
          newExternalId: fresh.id,
          email: leagueEmail,
        },
      });

      logger.info(
        { accountId, actorId, action: 'unsuspend_claude' },
        '[external-account-lifecycle] unsuspend: complete',
      );

      return updated;
    }

    throw new UnprocessableError(
      `Unsupported account type "${account.type}" for unsuspend`,
    );
  }

  /**
   * Resolve the League email for a user when re-inviting a suspended Claude
   * invite. Preference order:
   *   1. The external_id of any workspace ExternalAccount belonging to the
   *      user (regardless of status) — by project convention this field
   *      holds the League email.
   *   2. The user's primary_email.
   * Returns null when neither is available.
   */
  private async resolveLeagueEmailForUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<string | null> {
    const workspace = await (tx as any).externalAccount.findFirst({
      where: { user_id: userId, type: 'workspace' },
      orderBy: { status_changed_at: 'desc' },
    });
    if (workspace?.external_id) return workspace.external_id;
    const user = await (tx as any).user.findUnique({
      where: { id: userId },
      select: { primary_email: true },
    });
    return user?.primary_email ?? null;
  }

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------

  /**
   * Remove an external account.
   *
   * For workspace: calls suspendUser if not already suspended, sets
   * scheduled_delete_at = now + WORKSPACE_DELETE_DELAY_DAYS, and sets
   * status=removed, status_changed_at=now. The actual hard-delete is deferred
   * to WorkspaceDeleteJob (T006).
   *
   * For claude: calls ClaudeTeamAdminClient.removeMember, then sets
   * status=removed, status_changed_at=now.
   *
   * @throws NotFoundError      if accountId does not exist.
   * @throws UnprocessableError if the account is already status=removed.
   */
  async remove(
    accountId: number,
    actorId: number,
    tx: Prisma.TransactionClient,
  ): Promise<ExternalAccount> {
    // --- 1. Fetch and validate ---
    const account = await this.externalAccountRepo.findById(tx, accountId);
    if (!account) {
      throw new NotFoundError(`ExternalAccount ${accountId} not found`);
    }
    if (account.status === 'removed') {
      throw new UnprocessableError(
        `ExternalAccount ${accountId} is already removed`,
      );
    }

    logger.info(
      { accountId, actorId, type: account.type, currentStatus: account.status },
      '[external-account-lifecycle] remove: starting',
    );

    // --- 2. Call external API ---
    const now = new Date();
    let scheduledDeleteAt: Date | undefined;

    if (account.type === 'workspace') {
      const email = account.external_id;
      if (!email) {
        throw new UnprocessableError(
          `ExternalAccount ${accountId} has no external_id (workspace email); cannot remove`,
        );
      }

      // Suspend first unless already suspended
      if (account.status !== 'suspended') {
        await this.googleClient.suspendUser(email);
        logger.info({ accountId, email }, '[external-account-lifecycle] remove: workspace user suspended before removal');
      }

      // Compute deferred delete deadline
      const delayDays = parseDelayDays();
      scheduledDeleteAt = new Date(now.getTime() + delayDays * 86400000);
      logger.info(
        { accountId, delayDays, scheduledDeleteAt },
        '[external-account-lifecycle] remove: scheduled_delete_at set',
      );
    } else if (account.type === 'claude') {
      const memberId = account.external_id;
      if (!memberId) {
        throw new UnprocessableError(
          `ExternalAccount ${accountId} has no external_id (Claude member id); cannot remove`,
        );
      }
      // External id may be an invite id (never accepted) or a user id
      // (invite accepted, now an org member). The Admin API rejects
      // cross-calls with "User id must have `user_` prefix."
      //
      // 404 (NotFound) and 400 (frequently returned when an invite has
      // already been cancelled or accepted) are treated as no-ops:
      // the upstream record is already gone, so local cleanup should
      // proceed. Anything else bubbles.
      const isAlreadyGone = (err: unknown): boolean =>
        err instanceof AnthropicAdminApiError &&
        (err.statusCode === 404 || err.statusCode === 400);

      if (memberId.startsWith('invite_')) {
        try {
          await this.claudeTeamClient.cancelInvite(memberId);
          logger.info(
            { accountId, memberId },
            '[external-account-lifecycle] remove: cancelled outstanding Claude invite',
          );
        } catch (err) {
          if (!isAlreadyGone(err)) throw err;
          logger.info(
            { accountId, memberId, statusCode: (err as AnthropicAdminApiError).statusCode },
            '[external-account-lifecycle] remove: Claude invite already gone upstream — treating as no-op',
          );
        }
      } else {
        try {
          await this.claudeTeamClient.deleteOrgUser(memberId);
          logger.info(
            { accountId, memberId },
            '[external-account-lifecycle] remove: claude org user deleted',
          );
        } catch (err) {
          if (!isAlreadyGone(err)) throw err;
          logger.info(
            { accountId, memberId, statusCode: (err as AnthropicAdminApiError).statusCode },
            '[external-account-lifecycle] remove: Claude org user already gone upstream — treating as no-op',
          );
        }
      }
    }

    // --- 3. Persist status change ---
    const updateData: {
      status: 'removed';
      status_changed_at: Date;
      scheduled_delete_at?: Date;
    } = {
      status: 'removed',
      status_changed_at: now,
    };
    if (scheduledDeleteAt !== undefined) {
      updateData.scheduled_delete_at = scheduledDeleteAt;
    }

    const updated = await this.externalAccountRepo.update(tx, accountId, updateData);

    // --- 4. Emit audit event ---
    const action = account.type === 'workspace' ? 'remove_workspace' : 'remove_claude';
    await this.auditService.record(tx, {
      actor_user_id: actorId,
      action,
      target_user_id: account.user_id,
      target_entity_type: 'ExternalAccount',
      target_entity_id: String(accountId),
      details: {
        previousStatus: account.status,
        externalId: account.external_id,
        scheduledDeleteAt: scheduledDeleteAt?.toISOString() ?? null,
      },
    });

    logger.info(
      { accountId, actorId, action },
      '[external-account-lifecycle] remove: complete',
    );

    return updated;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse WORKSPACE_DELETE_DELAY_DAYS from environment, defaulting to
 * DEFAULT_WORKSPACE_DELETE_DELAY_DAYS (3). Non-numeric or missing values
 * silently fall back to the default.
 */
function parseDelayDays(): number {
  const raw = process.env.WORKSPACE_DELETE_DELAY_DAYS;
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_WORKSPACE_DELETE_DELAY_DAYS;
}
