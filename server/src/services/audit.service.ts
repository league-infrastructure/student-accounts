/**
 * AuditService — cross-cutting helper for recording audit events.
 *
 * This service enforces the UC-021 atomicity requirement: every audit event
 * is written inside the caller's Prisma transaction. AuditService never
 * opens its own transaction. The caller always owns the transaction boundary.
 *
 * Usage:
 *   await prisma.$transaction(async (tx) => {
 *     const user = await UserRepository.create(tx, data);
 *     await auditService.record(tx, {
 *       action: 'create_user',
 *       target_entity_type: 'User',
 *       target_entity_id: String(user.id),
 *     });
 *   });
 *
 * If the transaction rolls back for any reason (including an audit write
 * failure), both the primary write and the audit row are rolled back.
 */

import type { Prisma } from '../generated/prisma/client.js';

/**
 * Canonical action strings for all audit events in the system.
 * Using a union type prevents typos and makes action names discoverable.
 */
export type AuditAction =
  | 'create_user'
  | 'add_login'
  | 'remove_login'
  | 'provision_workspace'
  | 'provision_claude'
  | 'suspend_workspace'
  | 'suspend_claude'
  | 'remove_workspace'
  | 'remove_claude'
  | 'create_cohort'
  | 'assign_cohort'
  | 'merge_approve'
  | 'merge_reject'
  | 'merge_defer'
  | 'pike13_sync'
  | 'pike13_writeback_github'
  | 'pike13_writeback_email'
  | 'create_provisioning_request'
  | 'approve_provisioning_request'
  | 'reject_provisioning_request'
  | 'auth_denied'
  | 'role_changed'
  // Allow any string so future actions are not blocked at compile time
  | (string & {});

export interface AuditEventInput {
  /** null or undefined for system-initiated actions (scheduled jobs, scanners). */
  actor_user_id?: number | null;
  /** Canonical action string — see AuditAction for the defined values. */
  action: AuditAction;
  target_user_id?: number | null;
  target_entity_type?: string;
  target_entity_id?: string;
  details?: Record<string, unknown>;
}

/**
 * AuditService writes one AuditEvent row per call. It has no state and no
 * constructor parameters. Instantiate it once in ServiceRegistry.
 */
export class AuditService {
  /**
   * Record an audit event inside the caller's transaction.
   *
   * @param tx  - A Prisma interactive transaction client owned by the caller.
   * @param event - The event payload to persist.
   */
  async record(tx: Prisma.TransactionClient, event: AuditEventInput): Promise<void> {
    await (tx as any).auditEvent.create({ data: event });
  }
}
