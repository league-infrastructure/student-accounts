/**
 * ProvisioningRequestService — full implementation (Sprint 003 + Sprint 004 T007).
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
 *  - If request.requested_type === 'claude', approve() remains a pure status
 *    update (Sprint 005 will wire claude provisioning).
 *  - notifyAdmin() is a no-op this sprint; Sprint 004+ will implement it.
 */

import pino from 'pino';
import { ConflictError, NotFoundError, UnprocessableError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { ExternalAccountService } from './external-account.service.js';
import type { WorkspaceProvisioningService } from './workspace-provisioning.service.js';
import { ProvisioningRequestRepository } from './repositories/provisioning-request.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type { ProvisioningRequest } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';

const logger = pino({ name: 'provisioning-request' });

export type CreateRequestType = 'workspace' | 'claude' | 'workspace_and_claude';

export class ProvisioningRequestService {
  constructor(
    private prisma: any,
    private audit: AuditService,
    private externalAccountService: ExternalAccountService,
    private workspaceProvisioningService?: WorkspaceProvisioningService,
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

        const existingWorkspaceRequest = await (tx as any).provisioningRequest.findFirst({
          where: {
            user_id: userId,
            requested_type: 'workspace',
            status: { in: ['pending', 'approved'] },
          },
        });
        if (existingWorkspaceRequest) {
          throw new ConflictError(
            `User ${userId} already has a pending or approved workspace provisioning request`,
          );
        }
      }

      // --- claude constraint check ---
      if (wantsClaude) {
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
   * If the request type is 'claude', approval remains a pure status update.
   * Claude seat provisioning is handled by Sprint 005's WorkspaceClaudeService.
   * TODO(Sprint 005): wire claude provisioning here when WorkspaceClaudeService is available.
   *
   * @throws NotFoundError if the request does not exist.
   * @throws ConflictError if the request is not in 'pending' status.
   */
  async approve(requestId: number, deciderId: number): Promise<ProvisioningRequest> {
    const existing = await ProvisioningRequestRepository.findById(this.prisma, requestId);
    if (!existing) throw new NotFoundError(`ProvisioningRequest ${requestId} not found`);
    if (existing.status !== 'pending') {
      throw new ConflictError(
        `ProvisioningRequest ${requestId} cannot be approved: current status is '${existing.status}'`,
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await ProvisioningRequestRepository.updateStatus(
        tx,
        requestId,
        'approved',
        deciderId,
        new Date(),
      );
      await this.audit.record(tx, {
        actor_user_id: deciderId,
        action: 'approve_provisioning_request',
        target_user_id: existing.user_id,
        target_entity_type: 'ProvisioningRequest',
        target_entity_id: String(requestId),
        details: { requestedType: existing.requested_type },
      });

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
      } else {
        // requested_type === 'claude'
        // TODO(Sprint 005): call WorkspaceClaudeService.provision here when it is available.
        logger.info(
          { requestId, userId: existing.user_id, deciderId },
          '[provisioning-request] Claude request approved — provisioning deferred to Sprint 005 (WorkspaceClaudeService)',
        );
      }

      return updated;
    });
  }

  /**
   * Reject a provisioning request.
   *
   * Sets status=rejected, decided_by, decided_at, and records an audit event.
   *
   * @throws NotFoundError if the request does not exist.
   */
  async reject(requestId: number, deciderId: number): Promise<ProvisioningRequest> {
    const existing = await ProvisioningRequestRepository.findById(this.prisma, requestId);
    if (!existing) throw new NotFoundError(`ProvisioningRequest ${requestId} not found`);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await ProvisioningRequestRepository.updateStatus(
        tx,
        requestId,
        'rejected',
        deciderId,
        new Date(),
      );
      await this.audit.record(tx, {
        actor_user_id: deciderId,
        action: 'reject_provisioning_request',
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
