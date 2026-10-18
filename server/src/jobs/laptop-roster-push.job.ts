/**
 * LaptopRosterPushJob — hourly retry of failed laptop roster writes
 * (sprint 002 "laptop accounts" T004, SUC-002).
 *
 * Registered with SchedulerService under the name 'laptop-roster-push'.
 * A roster write that fails during a user action (Spaces down, not yet
 * configured) marks the user `laptop_roster_dirty`; this job reconciles
 * every dirty user on each run. `reconcile` never throws: a user whose
 * write fails again simply stays dirty for the next tick.
 */

import { createLogger } from '../services/logger.js';
import type { LaptopAccountService, ReconcileOutcome } from '../services/laptop/laptop-account.service.js';

const logger = createLogger('laptop-roster-push-job');

/** Name and frequency passed to SchedulerService.seedDefaults / registerHandler. */
export const JOB_NAME = 'laptop-roster-push';
export const JOB_FREQUENCY = 'hourly';

export interface LaptopRosterPushJobDeps {
  prisma: any;
  laptopAccounts: LaptopAccountService;
}

/**
 * Create the handler SchedulerService runs for 'laptop-roster-push'.
 * Dependencies are injected so tests can pass the real test Prisma and a
 * LaptopAccountService built on FakeLaptopRosterClient.
 */
export function createLaptopRosterPushJobHandler(
  deps: LaptopRosterPushJobDeps,
): () => Promise<void> {
  return async function runLaptopRosterPushJob(): Promise<void> {
    let dirty: Array<{ id: number }>;
    try {
      dirty = await deps.prisma.user.findMany({
        where: { laptop_roster_dirty: true },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      logger.error({ err }, '[laptop-roster-push-job] Failed to query dirty users. Aborting run.');
      return;
    }

    if (dirty.length === 0) return;
    logger.info({ count: dirty.length }, '[laptop-roster-push-job] Starting run.');

    const counts: Record<ReconcileOutcome, number> = {
      written: 0,
      locked: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    };
    for (const { id } of dirty) {
      const outcome = await deps.laptopAccounts.reconcile(id);
      counts[outcome]++;
    }

    logger.info(counts, '[laptop-roster-push-job] Run complete.');
  };
}
