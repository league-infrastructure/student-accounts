/**
 * Pike13WritebackService — real write-back implementation (Sprint 006 T004).
 *
 * Replaces the no-op stub at pike13-writeback.stub.ts. Exports:
 *  - Pike13WritebackService class (for testing via dependency injection)
 *  - leagueEmail() / githubHandle() module-level functions for existing call
 *    sites (lazy singleton backed by Pike13ApiClientImpl + real prisma client)
 *
 * Contract:
 *  - Neither function ever throws. Pike13 API failures are caught, logged at
 *    ERROR level, and recorded as audit events. The primary action that
 *    triggered the write-back must never be rolled back due to a write-back
 *    failure.
 *  - If the user has no active/pending pike13 ExternalAccount, the function
 *    returns immediately (no-op — no API call, no audit event).
 *  - If PIKE13_CUSTOM_FIELD_EMAIL_ID / PIKE13_CUSTOM_FIELD_GITHUB_ID is not
 *    set in the environment, the function logs a warning and returns (no-op).
 *
 * Environment variables read (via singleton factory):
 *  - PIKE13_ACCESS_TOKEN           — Bearer token for Pike13 API
 *  - PIKE13_API_URL / PIKE13_API_BASE — optional API base URL override
 *  - PIKE13_CUSTOM_FIELD_EMAIL_ID  — Pike13 custom field ID for League email
 *  - PIKE13_CUSTOM_FIELD_GITHUB_ID — Pike13 custom field ID for GitHub username
 *  - PIKE13_WRITE_ENABLED          — Must be "1" to allow write calls
 *
 * See UC-020 for the full write-back specification.
 */

import { createLogger } from '../logger.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuditAction } from '../audit.service.js';
import { AuditService } from '../audit.service.js';
import { ExternalAccountRepository } from '../repositories/external-account.repository.js';
import type { Pike13ApiClient } from './pike13-api.client.js';
import { Pike13ApiClientImpl } from './pike13-api.client.js';
import { prisma } from '../prisma.js';

const logger = createLogger('pike13-writeback');

// ---------------------------------------------------------------------------
// Pike13WritebackService class
// ---------------------------------------------------------------------------

export class Pike13WritebackService {
  private readonly auditService: AuditService;

  constructor(
    private readonly pike13Client: Pike13ApiClient,
    private readonly db: PrismaClient,
  ) {
    this.auditService = new AuditService();
  }

  /**
   * Update the user's League email custom field in Pike13.
   *
   * Steps:
   *  1. Look up the user's active/pending pike13 ExternalAccount.
   *     If absent: log info and return (no-op).
   *  2. Read PIKE13_CUSTOM_FIELD_EMAIL_ID; if absent, log warning and return.
   *  3. Call Pike13ApiClient.updateCustomField.
   *  4. On success: emit audit event action=pike13_writeback_email.
   *  5. On failure: log error + emit audit event with error detail; return.
   *
   * Never throws.
   */
  async leagueEmail(userId: number, email: string): Promise<void> {
    await this._writeBack({
      userId,
      value: email,
      fieldEnvVar: 'PIKE13_CUSTOM_FIELD_EMAIL_ID',
      auditAction: 'pike13_writeback_email',
      logContext: { email },
    });
  }

  /**
   * Update the user's GitHub username custom field in Pike13.
   *
   * Same steps as leagueEmail but uses PIKE13_CUSTOM_FIELD_GITHUB_ID
   * and action=pike13_writeback_github.
   *
   * Never throws.
   */
  async githubHandle(userId: number, handle: string): Promise<void> {
    await this._writeBack({
      userId,
      value: handle,
      fieldEnvVar: 'PIKE13_CUSTOM_FIELD_GITHUB_ID',
      auditAction: 'pike13_writeback_github',
      logContext: { handle },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _writeBack(opts: {
    userId: number;
    value: string;
    fieldEnvVar: 'PIKE13_CUSTOM_FIELD_EMAIL_ID' | 'PIKE13_CUSTOM_FIELD_GITHUB_ID';
    auditAction: AuditAction;
    logContext: Record<string, unknown>;
  }): Promise<void> {
    const { userId, value, fieldEnvVar, auditAction, logContext } = opts;

    // 1. Look up pike13 ExternalAccount
    let pike13Account;
    try {
      pike13Account = await ExternalAccountRepository.findActiveByUserAndType(
        this.db,
        userId,
        'pike13',
      );
    } catch (err) {
      logger.error(
        { userId, ...logContext, err },
        '[pike13-writeback] Failed to look up pike13 ExternalAccount — skipping write-back.',
      );
      return;
    }

    if (!pike13Account) {
      logger.info(
        { userId, ...logContext },
        '[pike13-writeback] No active pike13 ExternalAccount found — skipping write-back (no-op).',
      );
      return;
    }

    // 2. Validate field env var
    const fieldId = process.env[fieldEnvVar];
    if (!fieldId) {
      logger.warn(
        { userId, fieldEnvVar, ...logContext },
        `[pike13-writeback] ${fieldEnvVar} is not set — skipping write-back.`,
      );
      return;
    }

    // pike13 ExternalAccount.external_id holds the Pike13 person ID
    const personIdStr = pike13Account.external_id;
    if (!personIdStr) {
      logger.warn(
        { userId, externalAccountId: pike13Account.id, ...logContext },
        '[pike13-writeback] Pike13 ExternalAccount has no external_id — skipping write-back.',
      );
      return;
    }

    const personId = parseInt(personIdStr, 10);
    if (isNaN(personId)) {
      logger.warn(
        { userId, externalAccountId: pike13Account.id, personIdStr, ...logContext },
        '[pike13-writeback] Pike13 ExternalAccount external_id is not a valid integer — skipping write-back.',
      );
      return;
    }

    // 3. Call Pike13 API
    try {
      await this.pike13Client.updateCustomField(personId, fieldId, value);

      logger.info(
        { userId, personId, fieldId, auditAction, ...logContext },
        '[pike13-writeback] Custom field updated successfully.',
      );

      // 4. Emit success audit event
      await this.auditService.record(this.db as any, {
        action: auditAction,
        target_user_id: userId,
        details: {
          personId,
          fieldId,
          value,
        },
      });
    } catch (err) {
      // 5. Failure: log error + audit, never throw
      logger.error(
        { userId, personId, fieldId, auditAction, err, ...logContext },
        '[pike13-writeback] Pike13 API call failed — recording failure audit event.',
      );

      try {
        await this.auditService.record(this.db as any, {
          action: auditAction,
          target_user_id: userId,
          details: {
            personId,
            fieldId,
            value,
            error: err instanceof Error ? err.message : String(err),
            failed: true,
          },
        });
      } catch (auditErr) {
        logger.error(
          { userId, auditAction, auditErr },
          '[pike13-writeback] Failed to record failure audit event.',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton + exported functions
// (Drop-in replacement for the stub: same function signatures)
// ---------------------------------------------------------------------------

let _singleton: Pike13WritebackService | null = null;

function getSingleton(): Pike13WritebackService {
  if (!_singleton) {
    const accessToken = process.env.PIKE13_ACCESS_TOKEN ?? '';
    const pike13Client = new Pike13ApiClientImpl(accessToken);
    _singleton = new Pike13WritebackService(pike13Client, prisma);
  }
  return _singleton;
}

/**
 * Update the League email field on the user's Pike13 record.
 * No-op if no active pike13 ExternalAccount exists.
 * Never throws.
 */
export async function leagueEmail(userId: number, email: string): Promise<void> {
  return getSingleton().leagueEmail(userId, email);
}

/**
 * Update the GitHub username field on the user's Pike13 record.
 * No-op if no active pike13 ExternalAccount exists.
 * Never throws.
 */
export async function githubHandle(userId: number, handle: string): Promise<void> {
  return getSingleton().githubHandle(userId, handle);
}
