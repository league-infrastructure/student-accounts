/**
 * LlmProxyRequestPruneJob — daily retention sweep of the LLM proxy request
 * log (sprint 003, SUC-001).
 *
 * Registered with SchedulerService under the name 'llm-proxy-request-prune'.
 * `LlmProxyRequest` rows exist so "what did this student spend it on" is
 * answerable and the per-period spend can be recomputed; ninety days is
 * plenty for both, and the running totals on `LlmProxyToken` keep the
 * dollars after the rows are gone. Each run deletes rows whose `ts` is older
 * than RETENTION_DAYS. The handler never throws: a failed sweep is logged and
 * the next tick tries again.
 */

import { createLogger } from '../services/logger.js';
import { LlmProxyTokenRepository } from '../services/repositories/llm-proxy-token.repository.js';

const logger = createLogger('llm-proxy-request-prune-job');

/** Name and frequency passed to SchedulerService.seedDefaults / registerHandler. */
export const JOB_NAME = 'llm-proxy-request-prune';
export const JOB_FREQUENCY = 'daily';

/** Request-log retention. */
export const RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LlmProxyRequestPruneJobDeps {
  prisma: any;
  /** Clock; defaults to `() => new Date()`. Tests inject a fixed date. */
  now?: () => Date;
}

/** The oldest `ts` kept when the job runs at `now`. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

/**
 * Create the handler SchedulerService runs for 'llm-proxy-request-prune'.
 * Dependencies are injected so tests can pass the real test Prisma and a
 * fixed clock.
 */
export function createLlmProxyRequestPruneJobHandler(
  deps: LlmProxyRequestPruneJobDeps,
): () => Promise<void> {
  const now = deps.now ?? (() => new Date());
  return async function runLlmProxyRequestPruneJob(): Promise<void> {
    const cutoff = retentionCutoff(now());
    try {
      const deleted = await LlmProxyTokenRepository.deleteRequestsBefore(deps.prisma, cutoff);
      if (deleted > 0) {
        logger.info(
          { deleted, cutoff: cutoff.toISOString() },
          '[llm-proxy-request-prune-job] Pruned request log.',
        );
      }
    } catch (err) {
      logger.error(
        { err, cutoff: cutoff.toISOString() },
        '[llm-proxy-request-prune-job] Prune failed; will retry next run.',
      );
    }
  };
}
