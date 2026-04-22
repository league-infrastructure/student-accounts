/**
 * ProvisioningRequestRepository — typed CRUD for the ProvisioningRequest entity.
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * FK to user_id uses onDelete: Cascade — deleting a user cascades to their
 * provisioning requests. FK to decided_by uses onDelete: SetNull.
 */
import type { ProvisioningRequest } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

export type CreateProvisioningRequestInput = {
  user_id: number;
  requested_type: 'workspace' | 'claude';
  status?: 'pending' | 'approved' | 'rejected';
};

export class ProvisioningRequestRepository {
  static async create(
    db: DbClient,
    data: CreateProvisioningRequestInput,
  ): Promise<ProvisioningRequest> {
    return (db as any).provisioningRequest.create({ data });
  }

  static async findById(db: DbClient, id: number): Promise<ProvisioningRequest | null> {
    return (db as any).provisioningRequest.findUnique({ where: { id } });
  }

  /** Return all provisioning requests for a specific user, newest first. */
  static async findByUser(db: DbClient, user_id: number): Promise<ProvisioningRequest[]> {
    return (db as any).provisioningRequest.findMany({
      where: { user_id },
      // Primary sort by created_at desc; secondary sort by id desc as a
      // tiebreaker when records are created in the same millisecond (common
      // in tests and rapid-succession API calls).
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
  }

  /** Return all requests with status = 'pending', oldest first (FIFO processing). */
  static async findPending(db: DbClient): Promise<ProvisioningRequest[]> {
    return (db as any).provisioningRequest.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
    });
  }

  static async updateStatus(
    db: DbClient,
    id: number,
    status: 'pending' | 'approved' | 'rejected' | 'rejected_permanent',
    decided_by?: number | null,
    decided_at?: Date | null,
  ): Promise<ProvisioningRequest> {
    return (db as any).provisioningRequest.update({
      where: { id },
      data: {
        status,
        decided_by: decided_by ?? null,
        decided_at: decided_at ?? null,
      },
    });
  }
}
