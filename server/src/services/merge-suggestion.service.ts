/**
 * MergeSuggestionService — full implementation (Sprint 007 T004).
 *
 * Provides the administrative workflow for merge suggestions:
 *  - findQueueItems(): pending + deferred suggestions with user summaries
 *  - findDetailById(id): single suggestion with full user data
 *  - approve(id, survivorId, actorId): atomic transactional merge
 *  - reject(id, actorId): marks suggestion rejected with audit event
 *  - defer(id): hides suggestion from default queue without deciding
 *
 * MergeConflictError is thrown when an action is attempted on a suggestion
 * that is already in a terminal state (approved or rejected).
 */

import { MergeSuggestionRepository } from './repositories/merge-suggestion.repository.js';
import { AuditService } from './audit.service.js';
import type { MergeSuggestion } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotFoundError } from '../errors.js';

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown when an approve/reject/defer action is attempted on a suggestion
 * that is already in a terminal state (approved or rejected), or when
 * the survivor ID does not belong to the suggestion pair.
 */
export class MergeConflictError extends Error {
  readonly code = 'MERGE_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'MergeConflictError';
  }
}

// ---------------------------------------------------------------------------
// Queue / detail projection types
// ---------------------------------------------------------------------------

/** Lightweight user summary included in queue items. */
export interface UserSummary {
  id: number;
  display_name: string;
  primary_email: string;
}

/** A merge suggestion as it appears in the admin queue. */
export interface MergeSuggestionQueueItem {
  id: number;
  user_a: UserSummary;
  user_b: UserSummary;
  haiku_confidence: number;
  haiku_rationale: string | null;
  status: string;
  created_at: Date;
}

/** Full suggestion record with complete user data for the detail view. */
export interface MergeSuggestionDetail {
  id: number;
  user_a: {
    id: number;
    display_name: string;
    primary_email: string;
    cohort_id: number | null;
    logins: { id: number; provider: string; provider_email: string | null }[];
    external_accounts: { id: number; type: string; status: string }[];
  };
  user_b: {
    id: number;
    display_name: string;
    primary_email: string;
    cohort_id: number | null;
    logins: { id: number; provider: string; provider_email: string | null }[];
    external_accounts: { id: number; type: string; status: string }[];
  };
  haiku_confidence: number;
  haiku_rationale: string | null;
  status: string;
  decided_by: number | null;
  decided_at: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MergeSuggestionService {
  private audit: AuditService;

  constructor(
    private prisma: any,
    audit?: AuditService,
  ) {
    this.audit = audit ?? new AuditService();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Return all pending merge suggestions, oldest first.
   * Retained for backwards compatibility with Sprint 001 callers.
   */
  async findPending(): Promise<MergeSuggestion[]> {
    return MergeSuggestionRepository.findPending(this.prisma);
  }

  /**
   * Return the suggestion for a specific user pair.
   * Callers must canonicalise pair order (lower id first).
   */
  async findByPair(userAId: number, userBId: number): Promise<MergeSuggestion | null> {
    return MergeSuggestionRepository.findByPair(this.prisma, userAId, userBId);
  }

  /**
   * Return all pending + deferred suggestions with lightweight user summaries,
   * ordered oldest first (FIFO review queue).
   */
  async findQueueItems(): Promise<MergeSuggestionQueueItem[]> {
    const rows = await (this.prisma as any).mergeSuggestion.findMany({
      where: { status: { in: ['pending', 'deferred'] } },
      orderBy: { created_at: 'asc' },
      include: {
        user_a: { select: { id: true, display_name: true, primary_email: true } },
        user_b: { select: { id: true, display_name: true, primary_email: true } },
      },
    });
    return rows;
  }

  /**
   * Return a single suggestion with full User records (including Logins and
   * ExternalAccounts) for the admin detail view.
   *
   * @throws NotFoundError if no suggestion with that id exists.
   */
  async findDetailById(id: number): Promise<MergeSuggestionDetail> {
    const row = await (this.prisma as any).mergeSuggestion.findUnique({
      where: { id },
      include: {
        user_a: {
          include: {
            logins: { select: { id: true, provider: true, provider_email: true } },
            external_accounts: { select: { id: true, type: true, status: true } },
          },
        },
        user_b: {
          include: {
            logins: { select: { id: true, provider: true, provider_email: true } },
            external_accounts: { select: { id: true, type: true, status: true } },
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundError(`MergeSuggestion ${id} not found`);
    }

    return row;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Execute the merge atomically inside a single Prisma interactive transaction.
   *
   * Steps (all inside one transaction):
   *  1. Load and validate the suggestion — must be pending or deferred.
   *  2. Validate survivorId belongs to the pair.
   *  3. Re-parent all Logins from non-survivor → survivor.
   *  4. Re-parent all ExternalAccounts from non-survivor → survivor.
   *  5. Cohort inheritance: if survivor has no cohort and non-survivor does,
   *     copy it.
   *  6. Set non-survivor.is_active = false.
   *  7. Update suggestion: status=approved, decided_by, decided_at.
   *  8. Write merge_approve AuditEvent.
   *
   * @throws NotFoundError      if the suggestion does not exist.
   * @throws MergeConflictError if the suggestion is already approved/rejected,
   *                            or if survivorId is not part of the pair.
   */
  async approve(
    suggestionId: number,
    survivorUserId: number,
    actorId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: any) => {
      // 1. Load suggestion
      const suggestion = await MergeSuggestionRepository.findById(client, suggestionId);
      if (!suggestion) {
        throw new NotFoundError(`MergeSuggestion ${suggestionId} not found`);
      }

      // 2. Guard: must be actionable
      if (suggestion.status === 'approved' || suggestion.status === 'rejected') {
        throw new MergeConflictError(
          `MergeSuggestion ${suggestionId} is already ${suggestion.status}`,
        );
      }

      // 3. Validate survivor is part of the pair
      const { user_a_id, user_b_id } = suggestion;
      if (survivorUserId !== user_a_id && survivorUserId !== user_b_id) {
        throw new MergeConflictError(
          `survivorUserId ${survivorUserId} is not part of suggestion ${suggestionId}`,
        );
      }

      const nonSurvivorId =
        survivorUserId === user_a_id ? user_b_id : user_a_id;

      // 4. Re-parent Logins
      await client.login.updateMany({
        where: { user_id: nonSurvivorId },
        data: { user_id: survivorUserId },
      });

      // 5. Re-parent ExternalAccounts
      await client.externalAccount.updateMany({
        where: { user_id: nonSurvivorId },
        data: { user_id: survivorUserId },
      });

      // 6. Cohort inheritance
      const survivor = await client.user.findUniqueOrThrow({ where: { id: survivorUserId } });
      const nonSurvivor = await client.user.findUniqueOrThrow({ where: { id: nonSurvivorId } });

      if (survivor.cohort_id === null && nonSurvivor.cohort_id !== null) {
        await client.user.update({
          where: { id: survivorUserId },
          data: { cohort_id: nonSurvivor.cohort_id },
        });
      }

      // 7. Deactivate non-survivor
      await client.user.update({
        where: { id: nonSurvivorId },
        data: { is_active: false },
      });

      // 8. Mark suggestion approved
      await MergeSuggestionRepository.updateStatus(
        client,
        suggestionId,
        'approved',
        actorId,
        new Date(),
      );

      // 9. Audit
      await this.audit.record(client, {
        actor_user_id: actorId,
        action: 'merge_approve',
        target_user_id: survivorUserId,
        target_entity_type: 'MergeSuggestion',
        target_entity_id: String(suggestionId),
        details: { survivor_id: survivorUserId, non_survivor_id: nonSurvivorId },
      });
    };

    if (tx) {
      await run(tx);
    } else {
      await (this.prisma as any).$transaction(run);
    }
  }

  /**
   * Mark the suggestion as rejected and write an audit event.
   *
   * @throws NotFoundError      if the suggestion does not exist.
   * @throws MergeConflictError if the suggestion is already approved or rejected.
   */
  async reject(
    suggestionId: number,
    actorId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: any) => {
      const suggestion = await MergeSuggestionRepository.findById(client, suggestionId);
      if (!suggestion) {
        throw new NotFoundError(`MergeSuggestion ${suggestionId} not found`);
      }

      if (suggestion.status === 'approved' || suggestion.status === 'rejected') {
        throw new MergeConflictError(
          `MergeSuggestion ${suggestionId} is already ${suggestion.status}`,
        );
      }

      await MergeSuggestionRepository.updateStatus(
        client,
        suggestionId,
        'rejected',
        actorId,
        new Date(),
      );

      await this.audit.record(client, {
        actor_user_id: actorId,
        action: 'merge_reject',
        target_entity_type: 'MergeSuggestion',
        target_entity_id: String(suggestionId),
        details: {
          user_a_id: suggestion.user_a_id,
          user_b_id: suggestion.user_b_id,
        },
      });
    };

    if (tx) {
      await run(tx);
    } else {
      await (this.prisma as any).$transaction(run);
    }
  }

  /**
   * Defer the suggestion — hide it from the default queue but retain the row
   * for later review.  Does NOT set decided_by or decided_at.
   *
   * @throws NotFoundError      if the suggestion does not exist.
   * @throws MergeConflictError if the suggestion is already approved or rejected.
   */
  async defer(
    suggestionId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: any) => {
      const suggestion = await MergeSuggestionRepository.findById(client, suggestionId);
      if (!suggestion) {
        throw new NotFoundError(`MergeSuggestion ${suggestionId} not found`);
      }

      if (suggestion.status === 'approved' || suggestion.status === 'rejected') {
        throw new MergeConflictError(
          `MergeSuggestion ${suggestionId} is already ${suggestion.status}`,
        );
      }

      // Use direct update — decided_by and decided_at must remain null.
      await (client as any).mergeSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'deferred' },
      });
    };

    if (tx) {
      await run(tx);
    } else {
      await (this.prisma as any).$transaction(run);
    }
  }
}
