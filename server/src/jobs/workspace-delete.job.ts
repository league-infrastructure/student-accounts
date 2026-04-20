/**
 * WorkspaceDeleteJob — scheduled hard-deletion of Workspace accounts.
 *
 * Registered with SchedulerService under the name 'workspace-delete'.
 * Default interval: hourly (configurable via WORKSPACE_DELETE_JOB_INTERVAL_MINUTES).
 *
 * On each run the job:
 *  1. Queries ExternalAccount rows: type='workspace', status='removed',
 *     scheduled_delete_at IS NOT NULL and <= now().
 *  2. For each eligible record calls GoogleWorkspaceAdminClient.deleteUser(email).
 *  3. On success: sets scheduled_delete_at=null (prevents re-processing) and
 *     records an AuditEvent with action=workspace_hard_delete (actor_user_id=null).
 *  4. On failure: logs at ERROR level and continues to the next record (fail-soft).
 *
 * Each record is processed in its own prisma.$transaction so a failure on one
 * record does not roll back successful deletes.
 */

import { createLogger } from '../services/logger.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { GoogleWorkspaceAdminClient } from '../services/google-workspace/google-workspace-admin.client.js';
import { ExternalAccountRepository } from '../services/repositories/external-account.repository.js';
import { AuditEventRepository } from '../services/repositories/audit-event.repository.js';

const logger = createLogger('workspace-delete-job');

/** Frequency string passed to SchedulerService.seedDefaults / calculateNextRun. */
export const WORKSPACE_DELETE_JOB_NAME = 'workspace-delete';
export const WORKSPACE_DELETE_JOB_FREQUENCY = 'hourly';

/**
 * Create the handler function that WorkspaceDeleteJob will pass to
 * SchedulerService.registerHandler.
 *
 * Accepts prisma and a GoogleWorkspaceAdminClient so both can be injected
 * in tests (test double for the client, real Prisma for the DB).
 *
 * @param prisma  - Prisma client (full, not a transaction client).
 * @param wsClient - Google Workspace Admin client implementation.
 */
export function createWorkspaceDeleteJobHandler(
  prisma: PrismaClient,
  wsClient: GoogleWorkspaceAdminClient,
): () => Promise<void> {
  return async function runWorkspaceDeleteJob(): Promise<void> {
    const now = new Date();
    logger.info({ now }, '[workspace-delete-job] Starting run.');

    let eligible: Awaited<ReturnType<typeof ExternalAccountRepository.findPendingDeletion>>;
    try {
      eligible = await ExternalAccountRepository.findPendingDeletion(prisma as any, now);
    } catch (err) {
      logger.error({ err }, '[workspace-delete-job] Failed to query pending-deletion accounts. Aborting run.');
      return;
    }

    logger.info({ count: eligible.length }, '[workspace-delete-job] Eligible records found.');

    for (const account of eligible) {
      const email = account.external_id;
      if (!email) {
        logger.error(
          { accountId: account.id },
          '[workspace-delete-job] Account has no external_id (email) — skipping.',
        );
        continue;
      }

      try {
        // Call Google Workspace to hard-delete the account.
        await wsClient.deleteUser(email);

        // Per-record transaction: clear scheduled_delete_at and record audit event.
        await (prisma as any).$transaction(async (tx: any) => {
          await ExternalAccountRepository.update(tx, account.id, {
            scheduled_delete_at: null,
          });

          await AuditEventRepository.create(tx, {
            actor_user_id: null,
            action: 'workspace_hard_delete',
            target_user_id: account.user_id,
            target_entity_type: 'ExternalAccount',
            target_entity_id: String(account.id),
            details: { email, external_id: account.external_id },
          });
        });

        logger.info({ accountId: account.id, email }, '[workspace-delete-job] Hard-deleted account successfully.');
      } catch (err) {
        logger.error(
          { accountId: account.id, email, err },
          '[workspace-delete-job] Failed to hard-delete account. Continuing to next.',
        );
      }
    }

    logger.info('[workspace-delete-job] Run complete.');
  };
}
