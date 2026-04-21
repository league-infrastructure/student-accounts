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
      await this.claudeTeamClient.deleteOrgUser(memberId);
      logger.info({ accountId, memberId }, '[external-account-lifecycle] remove: claude org user deleted');
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
