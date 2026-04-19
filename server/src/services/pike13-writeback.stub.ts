/**
 * Pike13 write-back stub — placeholder for Sprint 006 implementation.
 *
 * This module exports no-op functions that will be called after workspace
 * provisioning (leagueEmail) and after a GitHub Login is attached (githubHandle).
 * Sprint 006 will replace this implementation wholesale at the same import path
 * — call sites in WorkspaceProvisioningService remain unchanged.
 *
 * This follows the same seam pattern as merge-scan.stub.ts (Sprint 002).
 *
 * See UC-005 step 6 and UC-020 for the full write-back specification.
 */

import pino from 'pino';

const logger = pino({ name: 'pike13-writeback' });

/**
 * No-op League email write-back. Logs deferral and returns immediately.
 * Sprint 006 will replace this with the real Pike13 API call that updates
 * the user's primary email field to their new @jointheleague.org address.
 *
 * @param userId - The internal User.id of the provisioned student.
 * @param email  - The League email address that was provisioned.
 */
export async function leagueEmail(userId: number, email: string): Promise<void> {
  logger.info(
    { userId, email },
    'pike13-writeback: leagueEmail deferred to Sprint 006 — no-op call site',
  );
}

/**
 * No-op GitHub handle write-back. Logs deferral and returns immediately.
 * Sprint 006 will replace this with the real Pike13 API call that updates
 * the user's GitHub username field in their Pike13 record.
 *
 * @param userId - The internal User.id of the student whose GitHub was linked.
 * @param handle - The GitHub username that was attached.
 */
export async function githubHandle(userId: number, handle: string): Promise<void> {
  logger.info(
    { userId, handle },
    'pike13-writeback: githubHandle deferred to Sprint 006',
  );
}
