/**
 * ExternalAccountRepository — typed CRUD for the ExternalAccount entity.
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * FK to User uses onDelete: Restrict — deleting a user that still has
 * ExternalAccount rows will throw a Prisma FK error.
 *
 * A partial unique index (user_id, type) WHERE status IN ('pending','active')
 * is enforced at the DB level; violations surface as Prisma unique constraint
 * errors and propagate to callers.
 */
import type { ExternalAccount } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

export type CreateExternalAccountInput = {
  user_id: number;
  type: 'workspace' | 'claude' | 'pike13';
  external_id?: string | null;
  status?: 'pending' | 'active' | 'suspended' | 'removed';
  status_changed_at?: Date | null;
};

export type UpdateExternalAccountInput = {
  status?: 'pending' | 'active' | 'suspended' | 'removed';
  status_changed_at?: Date | null;
  scheduled_delete_at?: Date | null;
};

export class ExternalAccountRepository {
  static async create(db: DbClient, data: CreateExternalAccountInput): Promise<ExternalAccount> {
    return (db as any).externalAccount.create({ data });
  }

  static async findById(db: DbClient, id: number): Promise<ExternalAccount | null> {
    return (db as any).externalAccount.findUnique({ where: { id } });
  }

  /** Return all external accounts for a user, ordered by creation date. */
  static async findAllByUser(db: DbClient, user_id: number): Promise<ExternalAccount[]> {
    return (db as any).externalAccount.findMany({
      where: { user_id },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Return the active or pending account of the given type for a user.
   * Returns null when no such account exists.
   */
  static async findActiveByUserAndType(
    db: DbClient,
    user_id: number,
    type: 'workspace' | 'claude' | 'pike13',
  ): Promise<ExternalAccount | null> {
    return (db as any).externalAccount.findFirst({
      where: {
        user_id,
        type,
        status: { in: ['pending', 'active'] },
      },
    });
  }

  static async updateStatus(
    db: DbClient,
    id: number,
    status: 'pending' | 'active' | 'suspended' | 'removed',
  ): Promise<ExternalAccount> {
    return (db as any).externalAccount.update({
      where: { id },
      data: { status, status_changed_at: new Date() },
    });
  }

  /**
   * Return all workspace ExternalAccount rows that are in 'removed' status
   * and have a scheduled_delete_at in the past (i.e., <= now).
   *
   * These are the records eligible for hard-deletion by WorkspaceDeleteJob.
   */
  static async findPendingDeletion(db: DbClient, now: Date = new Date()): Promise<ExternalAccount[]> {
    return (db as any).externalAccount.findMany({
      where: {
        type: 'workspace',
        status: 'removed',
        scheduled_delete_at: {
          not: null,
          lte: now,
        },
      },
    });
  }

  /**
   * Update arbitrary fields on an ExternalAccount row.
   * Intended for lifecycle operations that need to set status, status_changed_at,
   * and/or scheduled_delete_at atomically in a single update.
   */
  static async update(
    db: DbClient,
    id: number,
    data: UpdateExternalAccountInput,
  ): Promise<ExternalAccount> {
    return (db as any).externalAccount.update({ where: { id }, data });
  }

  static async delete(db: DbClient, id: number): Promise<ExternalAccount> {
    return (db as any).externalAccount.delete({ where: { id } });
  }
}
