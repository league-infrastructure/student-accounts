/**
 * ProvisioningRequestService — full implementation (Sprint 003 + Sprint 004 T007 + Sprint 005 T007).
 *
 * Manages the lifecycle of provisioning requests from creation through
 * administrative decision.
 *
 * Business rules enforced here:
 *  - A Claude seat request requires the user to have an active/pending
 *    workspace ExternalAccount OR a pending/approved workspace
 *    ProvisioningRequest (the "League-email constraint"). This check
 *    runs inside the same prisma.$transaction as the write.
 *  - workspace_and_claude creates two rows atomically.
 *  - Duplicate outstanding workspace requests are blocked (ConflictError).
 *
 * Sprint 004 T007 — approve() wired to WorkspaceProvisioningService:
 *  - If request.requested_type === 'workspace', approve() calls
 *    workspaceProvisioningService.provision(userId, deciderId, tx) inside
 *    the same transaction. If provision() throws, the whole transaction rolls
 *    back and the request stays 'pending'.
 *
 * Sprint 005 T007 — approve() wired to ClaudeProvisioningService:
 *  - If request.requested_type === 'claude', approve() calls
 *    claudeProvisioningService.provision(userId, deciderId, tx) inside
 *    the same transaction. If provision() throws, the whole transaction rolls
 *    back and the request stays 'pending'.
 *  - notifyAdmin() is a no-op this sprint; Sprint 004+ will implement it.
 */

import { createLogger } from './logger.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { ExternalAccountService } from './external-account.service.js';
import type { WorkspaceProvisioningService } from './workspace-provisioning.service.js';
import type { ClaudeProvisioningService } from './claude-provisioning.service.js';
import type { LlmProxyTokenService } from './llm-proxy-token.service.js';
import { ProvisioningRequestRepository } from './repositories/provisioning-request.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type { ProvisioningRequest } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';

const logger = createLogger('provisioning-request');

export type CreateRequestType =
  | 'workspace'
  | 'claude'
  | 'workspace_and_claude'
  | 'llm_proxy';

export class ProvisioningRequestService {
  constructor(
    private prisma: any,
    private audit: AuditService,
    private externalAccountService: ExternalAccountService,
    private workspaceProvisioningService?: WorkspaceProvisioningService,
    private claudeProvisioningService?: ClaudeProvisioningService,
    private llmProxyTokenService?: LlmProxyTokenService,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries (unchanged from Sprint 001 stub)
  // ---------------------------------------------------------------------------

  /** Return all pending provisioning requests, oldest first (FIFO). */
  async findPending(): Promise<ProvisioningRequest[]> {
    return ProvisioningRequestRepository.findPending(this.prisma);
  }

  /** Return all provisioning requests for a specific user, newest first. */
  async findByUser(userId: number): Promise<ProvisioningRequest[]> {
    return ProvisioningRequestRepository.findByUser(this.prisma, userId);
  }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  /**
   * Create one or two ProvisioningRequest rows atomically.
   *
   * @param userId      - The student requesting provisioning.
   * @param requestType - 'workspace' | 'workspace_and_claude' | 'claude'.
   *                      'claude' alone is blocked unless workspace baseline exists.
   * @param actorId     - The user performing the action (normally the same student).
   *
   * @throws ConflictError (409) if a pending/active workspace ExternalAccount OR
   *         a pending/approved workspace ProvisioningRequest already exists and
   *         requestType includes workspace.
   * @throws UnprocessableError (422) if requestType includes claude but the user
   *         has no pending/active workspace ExternalAccount and no pending/approved
   *         workspace ProvisioningRequest.
   */
  async create(
    userId: number,
    requestType: CreateRequestType,
    actorId: number,
  ): Promise<ProvisioningRequest[]> {
    const wantsWorkspace = requestType === 'workspace' || requestType === 'workspace_and_claude';
    const wantsClaude = requestType === 'claude' || requestType === 'workspace_and_claude';
    const wantsLlmProxy = requestType === 'llm_proxy';

    const results = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created: ProvisioningRequest[] = [];

      // --- workspace conflict check ---
      if (wantsWorkspace) {
        const existingWorkspaceAccount = await ExternalAccountRepository.findActiveByUserAndType(
          tx,
          userId,
          'workspace',
        );
        if (existingWorkspaceAccount) {
          throw new ConflictError(
            `User ${userId} already has an active or pending workspace account`,
          );
        }

        // Only *pending* requests block a new one. An earlier approved
        // request that was later suspended/removed (by the admin or by
        // lifecycle) shouldn't prevent the student from asking to have
        // the account re-activated — the active/pending ExternalAccount
        // check above is the real duplicate guard.
        const existingWorkspaceRequest = await (tx as any).provisioningRequest.findFirst({
          where: {
            user_id: userId,
            requested_type: 'workspace',
            status: 'pending',
          },
        });
        if (existingWorkspaceRequest) {
          throw new ConflictError(
            `User ${userId} already has a pending workspace provisioning request`,
          );
        }

        const permaRejectedWorkspace = await (tx as any).provisioningRequest.findFirst({
          where: {
            user_id: userId,
            requested_type: 'workspace',
            status: 'rejected_permanent',
          },
        });
        if (permaRejectedWorkspace) {
          throw new ConflictError(
            `User ${userId} has been permanently denied a workspace account. Contact an admin.`,
          );
        }
      }

      // --- claude constraint check ---
      if (wantsClaude) {
        const permaRejectedClaude = await (tx as any).provisioningRequest.findFirst({
          where: {
            user_id: userId,
            requested_type: 'claude',
            status: 'rejected_permanent',
          },
        });
        if (permaRejectedClaude) {
          throw new ConflictError(
            `User ${userId} has been permanently denied a Claude seat. Contact an admin.`,
          );
        }

        // When workspace_and_claude, the workspace row is created in the same
        // transaction, so we must check "will workspace exist after this tx?".
        // For workspace_and_claude we are about to create the workspace request
        // inside this very transaction — the Claude constraint will be satisfied
        // by that new row. We only need the hard check when 'claude' is requested
        // alone (no workspace is being created in this same call).
        if (requestType === 'claude') {
          const hasWorkspaceAccount = await ExternalAccountRepository.findActiveByUserAndType(
            tx,
            userId,
            'workspace',
          );
          const hasWorkspaceRequest = await (tx as any).provisioningRequest.findFirst({
            where: {
              user_id: userId,
              requested_type: 'workspace',
              status: { in: ['pending', 'approved'] },
            },
          });
          if (!hasWorkspaceAccount && !hasWorkspaceRequest) {
            throw new UnprocessableError(
              `User ${userId} must have a pending or active workspace account before requesting a Claude seat`,
            );
          }
        }
      }

      // --- llm_proxy constraint check ---
      if (wantsLlmProxy) {
        const existingActive = await (tx as any).llmProxyToken.findFirst({
          where: {
            user_id: userId,
            revoked_at: null,
            expires_at: { gt: new Date() },
          },
        });
        if (existingActive) {
          throw new ConflictError(
            `User ${userId} already has an active LLM proxy token`,
          );
        }
        const existingPending = await (tx as any).provisioningRequest.findFirst({
          where: {
            user_id: userId,
            requested_type: 'llm_proxy',
            status: 'pending',
          },
        });
        if (existingPending) {
          throw new ConflictError(
            `User ${userId} already has a pending LLM proxy request`,
          );
        }
        const permaRejected = await (tx as any).provisioningRequest.findFirst({
          where: {
            user_id: userId,
            requested_type: 'llm_proxy',
            status: 'rejected_permanent',
          },
        });
        if (permaRejected) {
          throw new ConflictError(
            `User ${userId} has been permanently denied LLM proxy access. Contact an admin.`,
          );
        }
      }

      // --- create workspace row ---
      if (wantsWorkspace) {
        const workspaceReq = await ProvisioningRequestRepository.create(tx, {
          user_id: userId,
          requested_type: 'workspace',
          status: 'pending',
        });
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: 'create_provisioning_request',
          target_user_id: userId,
          target_entity_type: 'ProvisioningRequest',
          target_entity_id: String(workspaceReq.id),
          details: {
            requestedType: 'workspace',
            provisioningRequestId: workspaceReq.id,
          },
        });
        created.push(workspaceReq);
      }

      // --- create claude row ---
      if (wantsClaude) {
        const claudeReq = await ProvisioningRequestRepository.create(tx, {
          user_id: userId,
          requested_type: 'claude',
          status: 'pending',
        });
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: 'create_provisioning_request',
          target_user_id: userId,
          target_entity_type: 'ProvisioningRequest',
          target_entity_id: String(claudeReq.id),
          details: {
            requestedType: 'claude',
            provisioningRequestId: claudeReq.id,
          },
        });
        created.push(claudeReq);
      }

      // --- create llm_proxy row ---
      if (wantsLlmProxy) {
        const req = await ProvisioningRequestRepository.create(tx, {
          user_id: userId,
          requested_type: 'llm_proxy',
          status: 'pending',
        });
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: 'create_provisioning_request',
          target_user_id: userId,
          target_entity_type: 'ProvisioningRequest',
          target_entity_id: String(req.id),
          details: {
            requestedType: 'llm_proxy',
            provisioningRequestId: req.id,
          },
        });
        created.push(req);
      }

      return created;
    });

    // Post-commit hook — no-op this sprint (Sprint 004+ implements notifications)
    await this.notifyAdmin(userId, requestType);

    return results;
  }

  // ---------------------------------------------------------------------------
  // approve / reject  (seams for Sprint 004)
  // ---------------------------------------------------------------------------

  /**
   * Approve a provisioning request.
   *
   * Sets status=approved, decided_by, decided_at, and records an audit event.
   * If the request type is 'workspace', also calls WorkspaceProvisioningService.provision
   * inside the same transaction. If provisioning fails, the entire transaction is rolled
   * back and the request stays 'pending'.
   *
   * If the request type is 'claude', approve() calls
   * ClaudeProvisioningService.provision inside the same transaction. If
   * provisioning fails, the entire transaction is rolled back and the request
   * stays 'pending'.
   *
   * @throws NotFoundError if the request does not exist.
   * @throws ConflictError if the request is not in 'pending' status.
   */
  async approve(
    requestId: number,
    deciderId: number,
    opts?: { cohortId?: number },
  ): Promise<ProvisioningRequest> {
    const existing = await ProvisioningRequestRepository.findById(this.prisma, requestId);
    if (!existing) throw new NotFoundError(`ProvisioningRequest ${requestId} not found`);
    if (existing.status !== 'pending') {
      throw new ConflictError(
        `ProvisioningRequest ${requestId} cannot be approved: current status is '${existing.status}'`,
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Optional cohort assignment — resolves the common "user has no cohort"
      // block without forcing the admin to leave the approval UI.
      if (opts?.cohortId != null) {
        await (tx as any).user.update({
          where: { id: existing.user_id },
          data: { cohort_id: opts.cohortId },
        });
        await this.audit.record(tx, {
          actor_user_id: deciderId,
          action: 'assign_cohort',
          target_user_id: existing.user_id,
          target_entity_type: 'User',
          target_entity_id: String(existing.user_id),
          details: { cohort_id: opts.cohortId, via: 'provisioning_request_approve' },
        });
      }

      const updated = await ProvisioningRequestRepository.updateStatus(
        tx,
        requestId,
        'approved',
        deciderId,
        new Date(),
      );

      // Build audit details — may be extended below for auto-chain.
      const auditDetails: Record<string, unknown> = { requestedType: existing.requested_type };

      if (existing.requested_type === 'workspace') {
        if (!this.workspaceProvisioningService) {
          throw new Error(
            'ProvisioningRequestService: workspaceProvisioningService is required to approve workspace requests but was not injected',
          );
        }
        logger.info(
          { requestId, userId: existing.user_id, deciderId },
          '[provisioning-request] Calling WorkspaceProvisioningService.provision for workspace request',
        );
        await this.workspaceProvisioningService.provision(existing.user_id, deciderId, tx);
      } else if (existing.requested_type === 'llm_proxy') {
        if (!this.llmProxyTokenService) {
          throw new Error(
            'ProvisioningRequestService: llmProxyTokenService is required to approve llm_proxy requests but was not injected',
          );
        }
        // Default grant: 30 days, 1M tokens. Admin can revoke/re-grant
        // with different caps from the user detail page.
        const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        logger.info(
          { requestId, userId: existing.user_id, deciderId },
          '[provisioning-request] Granting LLM proxy token for llm_proxy request',
        );
        await this.llmProxyTokenService.grant(
          existing.user_id,
          { expiresAt, tokenLimit: 1_000_000 },
          deciderId,
          { scope: 'single', scopeId: null },
        );
      } else {
        // requested_type === 'claude'
        if (!this.claudeProvisioningService) {
          throw new Error(
            'ProvisioningRequestService: claudeProvisioningService is required to approve claude requests but was not injected',
          );
        }

        // Auto-chain: if the user has no active workspace ExternalAccount,
        // provision the workspace first so ClaudeProvisioningService can
        // find it when it looks up the workspace email.
        const activeWorkspace = await (tx as any).externalAccount.findFirst({
          where: { user_id: existing.user_id, type: 'workspace', status: 'active' },
        });
        if (!activeWorkspace) {
          if (!this.workspaceProvisioningService) {
            throw new Error(
              'ProvisioningRequestService: workspaceProvisioningService is required for auto-chain but was not injected',
            );
          }
          logger.info(
            { requestId, userId: existing.user_id, deciderId },
            '[provisioning-request] Auto-chain: no active workspace — provisioning workspace before Claude',
          );
          await this.workspaceProvisioningService.provision(existing.user_id, deciderId, tx);
          auditDetails.auto_chained = true;
        }

        logger.info(
          { requestId, userId: existing.user_id, deciderId },
          '[provisioning-request] Calling ClaudeProvisioningService.provision for claude request',
        );
        await this.claudeProvisioningService.provision(existing.user_id, deciderId, tx);
      }

      await this.audit.record(tx, {
        actor_user_id: deciderId,
        action: 'approve_provisioning_request',
        target_user_id: existing.user_id,
        target_entity_type: 'ProvisioningRequest',
        target_entity_id: String(requestId),
        details: auditDetails,
      });

      return updated;
    });
  }

  /**
   * Reject a provisioning request. The student can submit a new request
   * of the same type after a plain reject. To block re-requests, use
   * `rejectPermanent` instead.
   *
   * @throws NotFoundError if the request does not exist.
   */
  async reject(requestId: number, deciderId: number): Promise<ProvisioningRequest> {
    return this._reject(requestId, deciderId, 'rejected');
  }

  /**
   * Permanently reject a provisioning request. After this call, the student
   * cannot re-request the same account type — `create()` will throw
   * ConflictError if another request of that type is submitted. Used when
   * the admin has decided the student should never get that account.
   */
  async rejectPermanent(
    requestId: number,
    deciderId: number,
  ): Promise<ProvisioningRequest> {
    return this._reject(requestId, deciderId, 'rejected_permanent');
  }

  private async _reject(
    requestId: number,
    deciderId: number,
    targetStatus: 'rejected' | 'rejected_permanent',
  ): Promise<ProvisioningRequest> {
    const existing = await ProvisioningRequestRepository.findById(this.prisma, requestId);
    if (!existing) throw new NotFoundError(`ProvisioningRequest ${requestId} not found`);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await ProvisioningRequestRepository.updateStatus(
        tx,
        requestId,
        targetStatus,
        deciderId,
        new Date(),
      );
      await this.audit.record(tx, {
        actor_user_id: deciderId,
        action:
          targetStatus === 'rejected_permanent'
            ? 'reject_provisioning_request_permanent'
            : 'reject_provisioning_request',
        target_user_id: existing.user_id,
        target_entity_type: 'ProvisioningRequest',
        target_entity_id: String(requestId),
        details: { requestedType: existing.requested_type },
      });
      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Placeholder hook called after the create transaction commits.
   * Sprint 004+ will implement email/webhook notification here.
   */
  private async notifyAdmin(
    _userId: number,
    _requestType: CreateRequestType,
  ): Promise<void> {
    // no-op this sprint
  }
}
