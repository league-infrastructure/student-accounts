/**
 * PassphraseService — domain logic for signup-passphrase lifecycle (Sprint 015).
 *
 * Responsibilities:
 *  - Create / rotate a signup passphrase for a Group or Cohort scope.
 *  - Revoke the active passphrase on a scope.
 *  - Return the current active passphrase record for a scope.
 *  - Resolve a raw passphrase string to the scope it belongs to (used by
 *    the public signup endpoint).
 *
 * "Active" passphrase: signup_passphrase IS NOT NULL AND
 *   signup_passphrase_expires_at > NOW()
 *
 * Collision detection: before persisting a new passphrase, check all Group
 * AND Cohort rows for any other scope that already owns the same plaintext
 * with a future expiry. If a collision is found, regenerate (up to 10
 * attempts). The probability of needing even two attempts with 621^3
 * combinations is vanishingly small.
 *
 * Errors thrown:
 *  - ValidationError (422) — explicit plaintext does not satisfy
 *    validatePassphraseShape.
 *  - Error (plain) — collision cap exceeded after 10 attempts (should
 *    never happen in practice).
 */

import { ValidationError } from '../errors.js';
import { generatePassphrase, validatePassphraseShape } from '../utils/passphrase.js';
import type { AuditService } from './audit.service.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PassphraseScope =
  | { kind: 'group'; id: number }
  | { kind: 'cohort'; id: number };

export interface PassphraseRecord {
  scope: 'group' | 'cohort';
  scopeId: number;
  plaintext: string;
  grantLlmProxy: boolean;
  expiresAt: Date;
  createdAt: Date;
  createdBy: number;
}

export interface PassphraseSignupMatch {
  scope: 'group' | 'cohort';
  id: number;
  grantLlmProxy: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PassphraseService {
  /** TTL for a passphrase — 1 hour in milliseconds. */
  static readonly TTL_MS = 60 * 60 * 1_000;

  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------

  /**
   * Create or rotate the signup passphrase for a scope.
   *
   * If `opts.plaintext` is provided, it is validated via
   * `validatePassphraseShape` and stored as-is (after trim+lowercase).
   * Otherwise a fresh 3-word phrase is generated.
   *
   * Regenerates on collision (same plaintext already active on a different
   * scope) up to 10 attempts, then throws.
   *
   * Wraps the DB update and audit event in a Prisma transaction.
   */
  async create(
    scope: PassphraseScope,
    opts: { plaintext?: string; grantLlmProxy: boolean },
    actorId: number,
  ): Promise<PassphraseRecord> {
    const MAX_ATTEMPTS = 10;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PassphraseService.TTL_MS);

    // Resolve plaintext, validating an explicit override.
    let candidate: string;
    const isExplicit = opts.plaintext !== undefined && opts.plaintext !== null && opts.plaintext !== '';
    if (isExplicit) {
      candidate = opts.plaintext!.trim().toLowerCase();
      if (!validatePassphraseShape(candidate)) {
        throw new ValidationError(
          `"${opts.plaintext}" is not a valid passphrase. ` +
            'Use 2–4 lowercase words from the word list joined by hyphens.',
        );
      }
    } else {
      candidate = generatePassphrase();
    }

    // Collision-retry loop.
    let attempt = 0;
    while (attempt < MAX_ATTEMPTS) {
      const collision = await this._hasCollision(scope, candidate, now);
      if (!collision) break;
      // For an explicit plaintext we cannot regenerate — the collision is a
      // business error (two scopes cannot share an active passphrase).
      if (isExplicit) {
        throw new ValidationError(
          `Passphrase "${candidate}" is already in use by another active scope. Choose a different phrase.`,
        );
      }
      candidate = generatePassphrase();
      attempt++;
    }
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        'Passphrase collision cap exceeded — could not generate a unique passphrase after ' +
          `${MAX_ATTEMPTS} attempts.`,
      );
    }

    // Persist inside a transaction.
    const model = scope.kind === 'group' ? 'group' : 'cohort';
    await this.prisma.$transaction(async (tx: any) => {
      await (tx as any)[model].update({
        where: { id: scope.id },
        data: {
          signup_passphrase: candidate,
          signup_passphrase_grant_llm_proxy: opts.grantLlmProxy,
          signup_passphrase_expires_at: expiresAt,
          signup_passphrase_created_at: now,
          signup_passphrase_created_by: actorId,
        },
      });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'create_signup_passphrase',
        target_entity_type: scope.kind === 'group' ? 'Group' : 'Cohort',
        target_entity_id: String(scope.id),
        details: {
          scope: scope.kind,
          scopeId: scope.id,
          grantLlmProxy: opts.grantLlmProxy,
        },
      });
    });

    return {
      scope: scope.kind,
      scopeId: scope.id,
      plaintext: candidate,
      grantLlmProxy: opts.grantLlmProxy,
      expiresAt,
      createdAt: now,
      createdBy: actorId,
    };
  }

  // --------------------------------------------------------------------------
  // revoke
  // --------------------------------------------------------------------------

  /**
   * Clear the passphrase fields on the scope row.
   *
   * Idempotent: if no active passphrase exists, does nothing (no audit event).
   * If an active passphrase exists, clears all five fields and writes a
   * `revoke_signup_passphrase` audit event.
   */
  async revoke(scope: PassphraseScope, actorId: number): Promise<void> {
    const active = await this.getActive(scope);
    if (!active) return; // No-op — nothing to revoke.

    const model = scope.kind === 'group' ? 'group' : 'cohort';
    await this.prisma.$transaction(async (tx: any) => {
      await (tx as any)[model].update({
        where: { id: scope.id },
        data: {
          signup_passphrase: null,
          signup_passphrase_grant_llm_proxy: false,
          signup_passphrase_expires_at: null,
          signup_passphrase_created_at: null,
          signup_passphrase_created_by: null,
        },
      });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'revoke_signup_passphrase',
        target_entity_type: scope.kind === 'group' ? 'Group' : 'Cohort',
        target_entity_id: String(scope.id),
        details: {
          scope: scope.kind,
          scopeId: scope.id,
        },
      });
    });
  }

  // --------------------------------------------------------------------------
  // getActive
  // --------------------------------------------------------------------------

  /**
   * Return the active passphrase record for a scope, or null if none / expired.
   */
  async getActive(scope: PassphraseScope): Promise<PassphraseRecord | null> {
    const model = scope.kind === 'group' ? 'group' : 'cohort';
    const now = new Date();
    const row = await (this.prisma as any)[model].findFirst({
      where: {
        id: scope.id,
        signup_passphrase: { not: null },
        signup_passphrase_expires_at: { gt: now },
      },
    });
    if (!row || !row.signup_passphrase || !row.signup_passphrase_expires_at) {
      return null;
    }
    return {
      scope: scope.kind,
      scopeId: scope.id,
      plaintext: row.signup_passphrase,
      grantLlmProxy: row.signup_passphrase_grant_llm_proxy,
      expiresAt: row.signup_passphrase_expires_at,
      createdAt: row.signup_passphrase_created_at ?? new Date(0),
      createdBy: row.signup_passphrase_created_by ?? 0,
    };
  }

  // --------------------------------------------------------------------------
  // findBySignupValue
  // --------------------------------------------------------------------------

  /**
   * Find an active, non-expired passphrase by exact plaintext match.
   * Searches both Group and Cohort tables. Returns null if not found or expired.
   */
  async findBySignupValue(plaintext: string): Promise<PassphraseSignupMatch | null> {
    const now = new Date();
    const where = {
      signup_passphrase: plaintext,
      signup_passphrase_expires_at: { gt: now },
    };

    // Check Cohort first (arbitrary ordering — both are checked).
    const cohortRow = await (this.prisma as any).cohort.findFirst({ where });
    if (cohortRow) {
      return {
        scope: 'cohort',
        id: cohortRow.id,
        grantLlmProxy: cohortRow.signup_passphrase_grant_llm_proxy,
      };
    }

    const groupRow = await (this.prisma as any).group.findFirst({ where });
    if (groupRow) {
      return {
        scope: 'group',
        id: groupRow.id,
        grantLlmProxy: groupRow.signup_passphrase_grant_llm_proxy,
      };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Returns true if `candidate` is already the active passphrase on any
   * Group or Cohort row OTHER than the target scope.
   */
  private async _hasCollision(
    scope: PassphraseScope,
    candidate: string,
    now: Date,
  ): Promise<boolean> {
    const expiryFilter = { signup_passphrase_expires_at: { gt: now } };

    // Check cohorts.
    const cohortMatch = await (this.prisma as any).cohort.findFirst({
      where: { signup_passphrase: candidate, ...expiryFilter },
    });
    if (cohortMatch) {
      // Only a collision if it's a different scope.
      const isSelf = scope.kind === 'cohort' && scope.id === cohortMatch.id;
      if (!isSelf) return true;
    }

    // Check groups.
    const groupMatch = await (this.prisma as any).group.findFirst({
      where: { signup_passphrase: candidate, ...expiryFilter },
    });
    if (groupMatch) {
      const isSelf = scope.kind === 'group' && scope.id === groupMatch.id;
      if (!isSelf) return true;
    }

    return false;
  }
}
