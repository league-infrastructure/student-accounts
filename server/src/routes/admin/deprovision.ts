/**
 * Admin deprovision route — composite student deprovision (Sprint 005 T009).
 *
 * POST /admin/users/:id/deprovision
 *
 * Removes all active/suspended workspace and claude ExternalAccounts for a
 * student. Pike13 accounts and Logins are not touched.
 *
 * This is a fail-soft composite: a per-account API failure is collected and
 * reported but does not prevent removal of the other accounts.
 *
 * Each per-account removal runs inside its own prisma.$transaction so that
 * a failure on one account does not roll back the others. A parent
 * deprovision_student audit event is emitted after all per-account operations
 * are attempted, in its own transaction.
 *
 * Response body:
 *   {
 *     succeeded: number[],   // accountIds successfully removed
 *     failed:    { accountId: number; error: string }[]
 *   }
 *
 * HTTP 207 (Multi-Status) when at least one account failed but some succeeded.
 * HTTP 200 when all accounts succeeded (including the no-op case: 0 accounts).
 * HTTP 404 when the user does not exist.
 * HTTP 403 for non-admin callers (enforced upstream by adminRouter).
 * HTTP 401 for unauthenticated callers (enforced upstream by adminRouter).
 */

import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { AuditService } from '../../services/audit.service.js';
import { ExternalAccountRepository } from '../../services/repositories/external-account.repository.js';
import { AppError } from '../../errors.js';
import { adminBus, userBus } from '../../services/change-bus.js';

export const adminDeprovisionRouter = Router();

const auditService = new AuditService();

// ---------------------------------------------------------------------------
// POST /admin/users/:id/deprovision
// ---------------------------------------------------------------------------

adminDeprovisionRouter.post('/users/:id/deprovision', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    // --- 1. Verify user exists ---
    const user = await (prisma as any).user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Actor is the logged-in admin.
    const actorId = (req.session as any).userId as number;

    // --- 2. Load all ExternalAccounts for the user ---
    const allAccounts = await ExternalAccountRepository.findAllByUser(prisma, userId);

    // --- 3. Filter to workspace and claude types with active or suspended status ---
    const eligible = allAccounts.filter(
      (a) =>
        (a.type === 'workspace' || a.type === 'claude') &&
        (a.status === 'active' || a.status === 'suspended'),
    );

    const succeeded: number[] = [];
    const failed: { accountId: number; error: string }[] = [];

    // --- 4. Remove each eligible account in its own transaction (fail-soft) ---
    for (const account of eligible) {
      try {
        await prisma.$transaction(async (tx: any) => {
          await req.services.externalAccountLifecycle.remove(account.id, actorId, tx);
        });
        succeeded.push(account.id);
      } catch (err: any) {
        failed.push({
          accountId: account.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- 5. Emit parent deprovision_student audit event ---
    try {
      await prisma.$transaction(async (tx: any) => {
        await auditService.record(tx, {
          actor_user_id: actorId,
          action: 'deprovision_student',
          target_user_id: userId,
          target_entity_type: 'User',
          target_entity_id: String(userId),
          details: {
            succeeded,
            failed: failed.map((f) => ({ accountId: f.accountId, error: f.error })),
          },
        });
      });
    } catch (_auditErr) {
      // Audit failure should not fail the HTTP response — log and continue.
      // In production, pino would log this; in tests it's silent.
    }

    // --- 6. Fire change notifications. Even with partial failures, any
    //        succeeded removal changes user state visible in admin views. ---
    if (succeeded.length > 0) {
      adminBus.notify('users');
      userBus.notifyUser(userId);
    }

    // --- 7. Return result ---
    const status = failed.length > 0 && succeeded.length > 0 ? 207 : 200;
    return res.status(status).json({ succeeded, failed });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});
