/**
 * MergeSuggestionRepository — typed CRUD for the MergeSuggestion entity.
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * FK to user_a_id / user_b_id uses onDelete: Cascade. FK to decided_by uses
 * onDelete: SetNull.
 *
 * The unique constraint (user_a_id, user_b_id) prevents duplicate suggestions
 * for the same pair. Callers are responsible for canonicalising pair order
 * (lower id first) before inserting.
 */
import type { MergeSuggestion } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

export type CreateMergeSuggestionInput = {
  user_a_id: number;
  user_b_id: number;
  haiku_confidence: number;
  haiku_rationale?: string | null;
  status?: 'pending' | 'approved' | 'rejected' | 'deferred';
};

export class MergeSuggestionRepository {
  static async create(
    db: DbClient,
    data: CreateMergeSuggestionInput,
  ): Promise<MergeSuggestion> {
    return (db as any).mergeSuggestion.create({ data });
  }

  static async findById(db: DbClient, id: number): Promise<MergeSuggestion | null> {
    return (db as any).mergeSuggestion.findUnique({ where: { id } });
  }

  /** Return all pending merge suggestions, oldest first (FIFO review). */
  static async findPending(db: DbClient): Promise<MergeSuggestion[]> {
    return (db as any).mergeSuggestion.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Return the suggestion for a specific user pair (exact order).
   * Callers must canonicalise pair order (lower id first) before calling.
   */
  static async findByPair(
    db: DbClient,
    user_a_id: number,
    user_b_id: number,
  ): Promise<MergeSuggestion | null> {
    return (db as any).mergeSuggestion.findUnique({
      where: { user_a_id_user_b_id: { user_a_id, user_b_id } },
    });
  }

  static async updateStatus(
    db: DbClient,
    id: number,
    status: 'pending' | 'approved' | 'rejected' | 'deferred',
    decided_by?: number | null,
    decided_at?: Date | null,
  ): Promise<MergeSuggestion> {
    return (db as any).mergeSuggestion.update({
      where: { id },
      data: {
        status,
        decided_by: decided_by ?? null,
        decided_at: decided_at ?? null,
      },
    });
  }
}
