/**
 * AuditEventRepository — typed CRUD for the AuditEvent entity.
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * AuditEvent rows are append-only in practice. There is no update or delete
 * method intentionally — audit logs must not be mutated. The actor/target FK
 * columns use onDelete: SetNull so user deletion does not destroy history.
 */
import type { AuditEvent } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

export type CreateAuditEventInput = {
  actor_user_id?: number | null;
  action: string;
  target_user_id?: number | null;
  target_entity_type?: string | null;
  target_entity_id?: string | null;
  details?: Record<string, unknown> | null;
};

export class AuditEventRepository {
  static async create(db: DbClient, data: CreateAuditEventInput): Promise<AuditEvent> {
    return (db as any).auditEvent.create({ data });
  }

  static async findById(db: DbClient, id: number): Promise<AuditEvent | null> {
    return (db as any).auditEvent.findUnique({ where: { id } });
  }

  /** Return events where the given user is the target, newest first. */
  static async findByTargetUser(
    db: DbClient,
    user_id: number,
    limit = 50,
  ): Promise<AuditEvent[]> {
    return (db as any).auditEvent.findMany({
      where: { target_user_id: user_id },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  /** Return events where the given user is the actor, newest first. */
  static async findByActor(
    db: DbClient,
    actor_user_id: number,
    limit = 50,
  ): Promise<AuditEvent[]> {
    return (db as any).auditEvent.findMany({
      where: { actor_user_id },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  /** Return events matching the given action string, newest first. */
  static async findByAction(
    db: DbClient,
    action: string,
    limit = 50,
  ): Promise<AuditEvent[]> {
    return (db as any).auditEvent.findMany({
      where: { action },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }
}
